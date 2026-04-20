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

    // Tesla cars enter sleep after ~10–15 minutes of inactivity. The
    // command/share endpoint returns 408 ("device offline") immediately on
    // a sleeping car instead of buffering, so we have to wake the car
    // ourselves before sending.
    //
    // wake_up is one of the few Fleet API endpoints that is NEVER signed
    // (chicken-and-egg: a sleeping car cannot authenticate commands). It
    // is sent over plain REST to the public Fleet API audience, NOT
    // through tesla-http-proxy. Source: teslamotors/vehicle-command
    // README → "wake_up over the Internet does not need to be signed".
    //
    // Tesla's official best-practice doc says wake can take "10 to 60
    // seconds" depending on the car's cellular signal. We poll
    // /vehicles/{id} with a progressive back-off (2s → 3s → 5s) to:
    //   1. respect Tesla's "don't repeatedly poll vehicle data" guidance,
    //   2. cover the worst case without bombarding the API,
    //   3. keep total cost in the single-digit cents-per-month range.
    private static readonly TimeSpan WakeMaxWait = TimeSpan.FromSeconds(60);
    private static readonly TimeSpan[] WakePollIntervals =
    {
        TimeSpan.FromSeconds(2),
        TimeSpan.FromSeconds(2),
        TimeSpan.FromSeconds(3),
        TimeSpan.FromSeconds(3),
        TimeSpan.FromSeconds(5),
        TimeSpan.FromSeconds(5),
        TimeSpan.FromSeconds(5),
        TimeSpan.FromSeconds(5),
        TimeSpan.FromSeconds(5),
        TimeSpan.FromSeconds(5),
        TimeSpan.FromSeconds(5),
        TimeSpan.FromSeconds(5),
        TimeSpan.FromSeconds(5),
    };

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

        // First attempt — fast path for cars that are already online.
        var first = await TrySendShareAsync(account, vehicle, trimmedValue, request.Locale, cancellationToken);
        if (first.Success || !ShouldRetryAfterWake(first.FailureKind))
            return first;

        _logger.LogInformation(
            "Vehicle {VehicleId} ({Vin}) appears to be asleep ({Kind}). Sending wake_up and retrying once.",
            vehicle.Id, vehicle.Vin, first.FailureKind);

        var wake = await WakeUpAndWaitAsync(account, vehicle, cancellationToken);
        if (!wake.Awoken)
            return ShareResult.Fail(ShareFailureKind.VehicleUnreachable,
                wake.Detail ??
                "The car did not wake up in time. It may have lost its cellular connection — try again in a moment.");

        var second = await TrySendShareAsync(account, vehicle, trimmedValue, request.Locale, cancellationToken);
        return second with { WokeUp = true };
    }

    private async Task<ShareResult> TrySendShareAsync(
        TeslaAccount account,
        TeslaVehicle vehicle,
        string value,
        string? locale,
        CancellationToken cancellationToken)
    {
        var token = _oauth.DecryptAccessToken(account);
        var normalisedLocale = NormalizeLocale(locale);
        var timestampMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds().ToString();

        var payload = new
        {
            type = "share_ext_content_raw",
            value = new Dictionary<string, string>
            {
                ["android.intent.extra.TEXT"] = value,
            },
            locale = normalisedLocale,
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

                // "vehicle unavailable" is Tesla's reason for an asleep car here.
                var rejectedKind = LooksLikeAsleep(teslaResult.Reason)
                    ? ShareFailureKind.VehicleUnreachable
                    : ShareFailureKind.Rejected;
                return ShareResult.Fail(rejectedKind, teslaResult.Reason ?? "Tesla rejected the destination.");
            }

            _logger.LogInformation(
                "Sent destination to vehicle {VehicleId} ({Vin}): {Value}",
                vehicle.Id, vehicle.Vin, Truncate(value, 120));

            return ShareResult.Ok();
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogError(ex, "Failed to send destination for vehicle {VehicleId}", vehicle.Id);
            return ShareResult.Fail(ShareFailureKind.Transport, ex.Message);
        }
    }

    private async Task<WakeOutcome> WakeUpAndWaitAsync(
        TeslaAccount account,
        TeslaVehicle vehicle,
        CancellationToken cancellationToken)
    {
        var token = _oauth.DecryptAccessToken(account);
        var client = _httpFactory.CreateClient("tesla");
        var baseUrl = account.Audience.TrimEnd('/');
        var wakeUrl = $"{baseUrl}/api/1/vehicles/{vehicle.TeslaVehicleId}/wake_up";

        // 1. Fire wake_up. Tesla returns immediately with the current vehicle
        //    state object; the actual wake takes a few seconds to propagate.
        try
        {
            using var wakeRequest = new HttpRequestMessage(HttpMethod.Post, wakeUrl);
            wakeRequest.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            wakeRequest.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
            using var wakeResponse = await client.SendAsync(wakeRequest, cancellationToken);
            if (!wakeResponse.IsSuccessStatusCode)
            {
                var body = await wakeResponse.Content.ReadAsStringAsync(cancellationToken);
                _logger.LogWarning(
                    "wake_up returned {StatusCode} for vehicle {VehicleId} ({Vin}): {Body}",
                    wakeResponse.StatusCode, vehicle.Id, vehicle.Vin, Truncate(body, 240));
                return new WakeOutcome(false, $"Tesla refused wake_up ({(int)wakeResponse.StatusCode}).");
            }
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogError(ex, "wake_up call failed for vehicle {VehicleId}", vehicle.Id);
            return new WakeOutcome(false, ex.Message);
        }

        // 2. Poll /vehicles/{id} until state=online or we hit the deadline.
        //    Progressive back-off keeps us within Tesla's "be gentle" guidance:
        //    typical wake completes inside the first 5–10s with only 2–4 polls.
        var deadline = DateTimeOffset.UtcNow + WakeMaxWait;
        var statusUrl = $"{baseUrl}/api/1/vehicles/{vehicle.TeslaVehicleId}";
        for (var attempt = 0; attempt < WakePollIntervals.Length; attempt++)
        {
            if (cancellationToken.IsCancellationRequested) break;
            await Task.Delay(WakePollIntervals[attempt], cancellationToken);
            if (DateTimeOffset.UtcNow >= deadline) break;

            try
            {
                using var statusRequest = new HttpRequestMessage(HttpMethod.Get, statusUrl);
                statusRequest.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
                statusRequest.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
                using var statusResponse = await client.SendAsync(statusRequest, cancellationToken);
                if (statusResponse.IsSuccessStatusCode)
                {
                    var body = await statusResponse.Content.ReadAsStringAsync(cancellationToken);
                    using var doc = JsonDocument.Parse(body);
                    if (doc.RootElement.TryGetProperty("response", out var resp)
                        && resp.TryGetProperty("state", out var st)
                        && st.ValueKind == JsonValueKind.String
                        && string.Equals(st.GetString(), "online", StringComparison.OrdinalIgnoreCase))
                    {
                        _logger.LogInformation(
                            "Vehicle {VehicleId} ({Vin}) woke up after {Attempts} poll(s).",
                            vehicle.Id, vehicle.Vin, attempt + 1);
                        return new WakeOutcome(true, null);
                    }
                }
            }
            catch
            {
                // ignore intermittent errors, we will retry within the loop
            }
        }

        _logger.LogWarning(
            "Vehicle {VehicleId} ({Vin}) did not become online within {Seconds}s.",
            vehicle.Id, vehicle.Vin, WakeMaxWait.TotalSeconds);
        return new WakeOutcome(false,
            $"Vehicle did not come online within {(int)WakeMaxWait.TotalSeconds}s after wake_up.");
    }

    private static bool ShouldRetryAfterWake(ShareFailureKind kind) =>
        kind is ShareFailureKind.VehicleUnreachable;

    private static bool LooksLikeAsleep(string? reason) =>
        reason is not null && (
            reason.Contains("vehicle unavailable", StringComparison.OrdinalIgnoreCase) ||
            reason.Contains("vehicle is asleep", StringComparison.OrdinalIgnoreCase) ||
            reason.Contains("offline", StringComparison.OrdinalIgnoreCase));

    private sealed record WakeOutcome(bool Awoken, string? Detail);

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

public sealed record ShareResult(bool Success, string? Error, ShareFailureKind FailureKind, bool WokeUp = false)
{
    public static ShareResult Ok() => new(true, null, ShareFailureKind.None);
    public static ShareResult Fail(ShareFailureKind kind, string error) => new(false, error, kind);
}

public sealed record ShareDestinationRequest(string Value, string? Locale);
