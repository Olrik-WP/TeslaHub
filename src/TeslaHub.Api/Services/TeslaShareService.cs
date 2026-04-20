using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using TeslaHub.Api.Data;
using TeslaHub.Api.Models;

namespace TeslaHub.Api.Services;

/// <summary>
/// Sends a single navigation destination to a paired Tesla via the Fleet API
/// `command/share` endpoint.
///
/// Important: this is one of the few commands documented by Tesla as
/// requiring server-side processing (address parsing) and therefore does NOT
/// go through the signed `tesla-http-proxy`. We send a plain bearer-token
/// REST request straight to the Fleet API audience configured for the user's
/// account. Source: teslamotors/vehicle-command pkg/proxy/command.go
/// (`navigation_request` returns ErrCommandUseRESTAPI).
///
/// Body format (legacy share_ext_content_raw, still required by Tesla in 2026):
/// {
///   "type": "share_ext_content_raw",
///   "value": { "android.intent.extra.TEXT": "<address or lat,lng or URL>" },
///   "locale": "fr-FR",
///   "timestamp_ms": "1700000000000"
/// }
/// </summary>
public sealed class TeslaShareService
{
    private readonly AppDbContext _db;
    private readonly TeslaOAuthService _oauth;
    private readonly IHttpClientFactory _httpFactory;
    private readonly ILogger<TeslaShareService> _logger;

    public TeslaShareService(
        AppDbContext db,
        TeslaOAuthService oauth,
        IHttpClientFactory httpFactory,
        ILogger<TeslaShareService> logger)
    {
        _db = db;
        _oauth = oauth;
        _httpFactory = httpFactory;
        _logger = logger;
    }

    public async Task<ShareResult> SendDestinationAsync(
        int vehicleId,
        ShareDestinationRequest request,
        CancellationToken cancellationToken)
    {
        var trimmedValue = request.Value?.Trim() ?? string.Empty;
        if (string.IsNullOrWhiteSpace(trimmedValue))
            return ShareResult.Fail(ShareFailureKind.InvalidRequest, "Destination value is empty.");

        var vehicle = await _db.Set<TeslaVehicle>()
            .Include(v => v.TeslaAccount)
            .FirstOrDefaultAsync(v => v.Id == vehicleId, cancellationToken);

        if (vehicle is null)
            return ShareResult.Fail(ShareFailureKind.VehicleNotFound,
                "Vehicle is not registered in TeslaHub. Sync your vehicles in Settings → Tesla integration.");

        if (vehicle.TeslaAccount is null)
            return ShareResult.Fail(ShareFailureKind.NotConfigured,
                "Tesla account is not connected. Configure Fleet API in Settings → Tesla integration.");

        if (!vehicle.KeyPaired)
            return ShareResult.Fail(ShareFailureKind.KeyNotPaired,
                "The TeslaHub virtual key is not paired with this vehicle. Pair it from Settings → Tesla integration.");

        var account = await _oauth.EnsureValidAccessTokenAsync(vehicle.TeslaAccount, cancellationToken);
        var token = _oauth.DecryptAccessToken(account);
        var locale = NormalizeLocale(request.Locale);
        var timestampMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds().ToString();

        var payload = new
        {
            type = "share_ext_content_raw",
            value = new Dictionary<string, string>
            {
                ["android.intent.extra.TEXT"] = trimmedValue,
            },
            locale,
            timestamp_ms = timestampMs,
        };

        var url = $"{account.Audience.TrimEnd('/')}/api/1/vehicles/{vehicle.TeslaVehicleId}/command/share";
        using var http = new HttpRequestMessage(HttpMethod.Post, url)
        {
            Content = JsonContent.Create(payload),
        };
        http.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        http.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));

        var client = _httpFactory.CreateClient("tesla");

        try
        {
            using var response = await client.SendAsync(http, cancellationToken);
            var body = await response.Content.ReadAsStringAsync(cancellationToken);

            if (!response.IsSuccessStatusCode)
            {
                _logger.LogWarning(
                    "Tesla command/share returned {StatusCode} for vehicle {VehicleId} ({Vin}): {Body}",
                    response.StatusCode, vehicle.Id, vehicle.Vin, Truncate(body, 500));

                var kind = ClassifyHttpFailure(response.StatusCode, body);
                return ShareResult.Fail(kind, BuildHttpErrorDetail(response.StatusCode, body, kind));
            }

            // Tesla wraps responses in { "response": { "result": true, "reason": "..." } }
            var teslaResult = TryParseTeslaResponse(body);
            if (teslaResult is { Result: false })
            {
                _logger.LogInformation(
                    "Tesla rejected share for vehicle {VehicleId} ({Vin}): {Reason}",
                    vehicle.Id, vehicle.Vin, teslaResult.Reason);
                return ShareResult.Fail(ShareFailureKind.Rejected, teslaResult.Reason ?? "Tesla rejected the destination.");
            }

            _logger.LogInformation(
                "Sent destination to vehicle {VehicleId} ({Vin}): {Value}",
                vehicle.Id, vehicle.Vin, Truncate(trimmedValue, 120));

            return ShareResult.Ok();
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogError(ex, "Failed to send destination for vehicle {VehicleId}", vehicle.Id);
            return ShareResult.Fail(ShareFailureKind.Transport, ex.Message);
        }
    }

    private static string NormalizeLocale(string? locale)
    {
        if (string.IsNullOrWhiteSpace(locale))
            return "en-US";

        var trimmed = locale.Trim();
        if (trimmed.Length == 2)
            return trimmed.ToLowerInvariant() switch
            {
                "fr" => "fr-FR",
                "de" => "de-DE",
                "es" => "es-ES",
                "it" => "it-IT",
                "nl" => "nl-NL",
                _ => "en-US",
            };
        return trimmed;
    }

    private static ShareFailureKind ClassifyHttpFailure(System.Net.HttpStatusCode status, string body) =>
        (int)status switch
        {
            401 or 403 => ShareFailureKind.Unauthorized,
            404 => ShareFailureKind.VehicleNotFound,
            408 or 504 => ShareFailureKind.VehicleUnreachable,
            _ when (int)status >= 500 => ShareFailureKind.Transport,
            _ => ShareFailureKind.Rejected,
        };

    private static string BuildHttpErrorDetail(System.Net.HttpStatusCode status, string body, ShareFailureKind kind)
    {
        var snippet = Truncate(body, 240);
        return kind switch
        {
            ShareFailureKind.Unauthorized => "Tesla refused the request. Reconnect your Tesla account in Settings.",
            ShareFailureKind.VehicleUnreachable =>
                "The vehicle did not respond in time. It may be offline — try again in a moment.",
            ShareFailureKind.Transport => $"Tesla service error ({(int)status}). Try again later.",
            _ => $"Tesla returned {(int)status}: {snippet}",
        };
    }

    private static TeslaCommandResponse? TryParseTeslaResponse(string body)
    {
        try
        {
            using var doc = JsonDocument.Parse(body);
            if (!doc.RootElement.TryGetProperty("response", out var response))
                return null;

            var result = response.TryGetProperty("result", out var r) && r.ValueKind == JsonValueKind.True;
            string? reason = null;
            if (response.TryGetProperty("reason", out var rs) && rs.ValueKind == JsonValueKind.String)
                reason = rs.GetString();
            if (response.TryGetProperty("string", out var s) && s.ValueKind == JsonValueKind.String && reason is null)
                reason = s.GetString();

            return new TeslaCommandResponse(result, reason);
        }
        catch
        {
            return null;
        }
    }

    private static string Truncate(string value, int max) =>
        value.Length <= max ? value : value[..max] + "…";

    private sealed record TeslaCommandResponse(bool Result, string? Reason);
}

public enum ShareFailureKind
{
    None = 0,
    InvalidRequest,
    NotConfigured,
    VehicleNotFound,
    KeyNotPaired,
    Unauthorized,
    Rejected,
    VehicleUnreachable,
    Transport,
}

public sealed record ShareResult(bool Success, string? Error, ShareFailureKind FailureKind)
{
    public static ShareResult Ok() => new(true, null, ShareFailureKind.None);
    public static ShareResult Fail(ShareFailureKind kind, string error) => new(false, error, kind);
}

public sealed record ShareDestinationRequest(string Value, string? Locale);
