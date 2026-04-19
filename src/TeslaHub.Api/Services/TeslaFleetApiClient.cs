using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using TeslaHub.Api.Models;

namespace TeslaHub.Api.Services;

/// <summary>
/// Thin client over the Tesla Fleet REST API.
/// Endpoints used in this PR:
///   POST /api/1/partner_accounts        (register this domain as a partner)
///   GET  /api/1/partner_accounts/public_key (verify which key Tesla sees)
///   GET  /api/1/vehicles                (list vehicles for the connected user)
/// Later PRs will add /api/1/vehicles/fleet_telemetry_config_create.
/// All requests use the audience configured on the OAuth account
/// (TESLA_AUDIENCE), and the bearer access token decrypted on the fly.
/// </summary>
public sealed class TeslaFleetApiClient
{
    private readonly IHttpClientFactory _httpFactory;
    private readonly TeslaOAuthService _oauth;
    private readonly ILogger<TeslaFleetApiClient> _logger;
    private readonly string? _proxyBaseUrl;

    public TeslaFleetApiClient(
        IHttpClientFactory httpFactory,
        TeslaOAuthService oauth,
        IConfiguration configuration,
        ILogger<TeslaFleetApiClient> logger)
    {
        _httpFactory = httpFactory;
        _oauth = oauth;
        _logger = logger;
        _proxyBaseUrl = configuration["TESLA_COMMAND_PROXY_URL"];
    }

    public async Task<PartnerRegistrationResult> RegisterPartnerDomainAsync(
        TeslaAccount account,
        string domain,
        CancellationToken cancellationToken)
    {
        // partner_accounts register/unregister REQUIRE a partner token
        // (client_credentials grant), NOT the user access token. See
        // https://developer.tesla.com/docs/fleet-api/authentication/partner-tokens
        var partnerToken = await _oauth.GetPartnerAccessTokenAsync(cancellationToken);

        var request = new HttpRequestMessage(HttpMethod.Post, $"{account.Audience.TrimEnd('/')}/api/1/partner_accounts")
        {
            Content = JsonContent.Create(new { domain }),
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", partnerToken);

        var client = _httpFactory.CreateClient("tesla");
        using var response = await client.SendAsync(request, cancellationToken);
        var body = await response.Content.ReadAsStringAsync(cancellationToken);

        if (!response.IsSuccessStatusCode)
        {
            _logger.LogWarning("Tesla partner_accounts returned {StatusCode}: {Body}",
                response.StatusCode, Truncate(body, 500));
            return new PartnerRegistrationResult(false, $"{(int)response.StatusCode} {response.StatusCode}: {Truncate(body, 300)}");
        }

        return new PartnerRegistrationResult(true, null);
    }

    public async Task<TelemetryConfigResult> CreateTelemetryConfigAsync(
        TeslaAccount account,
        TelemetryConfigRequest request,
        CancellationToken cancellationToken)
    {
        var refreshed = await _oauth.EnsureValidAccessTokenAsync(account, cancellationToken);
        var token = _oauth.DecryptAccessToken(refreshed);

        var payload = new
        {
            vins = request.Vins,
            config = new
            {
                hostname = request.Hostname,
                port = request.Port,
                ca = request.CaCertificate,
                fields = request.Fields,
            },
        };

        // Tesla requires fleet_telemetry_config to be sent through the
        // vehicle-command HTTP proxy so the request is signed by the
        // partner private key. The TESLA_COMMAND_PROXY_URL env var points
        // to the local proxy container (e.g. https://tesla-http-proxy:443).
        // The proxy preserves the user's bearer token and just adds the
        // signature on top, then forwards to fleet-api.
        var endpointBase = string.IsNullOrWhiteSpace(_proxyBaseUrl)
            ? refreshed.Audience.TrimEnd('/')
            : _proxyBaseUrl.TrimEnd('/');

        var url = $"{endpointBase}/api/1/vehicles/fleet_telemetry_config";

        var http = new HttpRequestMessage(HttpMethod.Post, url)
        {
            Content = JsonContent.Create(payload),
        };
        http.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);

        // The proxy uses a self-signed TLS cert by default — accept it for
        // the proxy hostname only. Direct Tesla calls keep strict TLS.
        var clientName = string.IsNullOrWhiteSpace(_proxyBaseUrl) ? "tesla" : "tesla-proxy";
        var client = _httpFactory.CreateClient(clientName);

        using var response = await client.SendAsync(http, cancellationToken);
        var body = await response.Content.ReadAsStringAsync(cancellationToken);

        if (!response.IsSuccessStatusCode)
        {
            _logger.LogWarning("Tesla fleet_telemetry_config returned {StatusCode}: {Body}",
                response.StatusCode, Truncate(body, 500));
            return new TelemetryConfigResult(false,
                $"{(int)response.StatusCode}: {Truncate(body, 300)}");
        }

        return new TelemetryConfigResult(true, null);
    }


    public async Task<List<TeslaVehicle>> ListVehiclesAsync(
        TeslaAccount account,
        CancellationToken cancellationToken)
    {
        var refreshed = await _oauth.EnsureValidAccessTokenAsync(account, cancellationToken);
        var token = _oauth.DecryptAccessToken(refreshed);

        var request = new HttpRequestMessage(HttpMethod.Get, $"{refreshed.Audience.TrimEnd('/')}/api/1/vehicles");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));

        var client = _httpFactory.CreateClient("tesla");
        using var response = await client.SendAsync(request, cancellationToken);
        var body = await response.Content.ReadAsStringAsync(cancellationToken);

        if (!response.IsSuccessStatusCode)
        {
            _logger.LogWarning("Tesla /api/1/vehicles returned {StatusCode}: {Body}",
                response.StatusCode, Truncate(body, 500));
            throw new InvalidOperationException($"Failed to fetch vehicles ({(int)response.StatusCode}).");
        }

        var parsed = JsonSerializer.Deserialize<VehiclesResponse>(body, JsonOptions);
        var entries = parsed?.Response ?? [];

        return entries.Select(v => new TeslaVehicle
        {
            TeslaAccountId = account.Id,
            Vin = v.Vin ?? string.Empty,
            TeslaVehicleId = v.Id ?? 0,
            DisplayName = v.DisplayName,
            Model = v.VehicleConfig?.CarType ?? v.OptionCodes,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
        }).Where(v => !string.IsNullOrEmpty(v.Vin)).ToList();
    }

    private static string Truncate(string value, int max) =>
        value.Length <= max ? value : value[..max] + "…";

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    private sealed class VehiclesResponse
    {
        [JsonPropertyName("response")] public List<VehicleEntry>? Response { get; set; }
    }

    private sealed class VehicleEntry
    {
        [JsonPropertyName("id")] public long? Id { get; set; }
        [JsonPropertyName("vin")] public string? Vin { get; set; }
        [JsonPropertyName("display_name")] public string? DisplayName { get; set; }
        [JsonPropertyName("option_codes")] public string? OptionCodes { get; set; }
        [JsonPropertyName("vehicle_config")] public VehicleConfigEntry? VehicleConfig { get; set; }
    }

    private sealed class VehicleConfigEntry
    {
        [JsonPropertyName("car_type")] public string? CarType { get; set; }
    }
}

public record PartnerRegistrationResult(bool Success, string? Error);

public record TelemetryConfigResult(bool Success, string? Error);

public record TelemetryConfigRequest(
    string[] Vins,
    string Hostname,
    int Port,
    string CaCertificate,
    Dictionary<string, TelemetryField> Fields);

public record TelemetryField(int IntervalSeconds);
