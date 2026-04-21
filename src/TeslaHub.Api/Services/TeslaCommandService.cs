using System.Collections.Concurrent;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using TeslaHub.Api.Data;
using TeslaHub.Api.Models;

namespace TeslaHub.Api.Services;

/// <summary>
/// Single entry point for ALL Tesla Fleet vehicle commands and reads.
/// Centralises the routing rules between the locally-hosted signed
/// `tesla-http-proxy` and direct REST calls to the Fleet API audience,
/// plus the wake-and-retry lifecycle that every command must respect.
///
/// Routing decision (verified against teslamotors/vehicle-command
/// pkg/proxy/command.go):
///   * SendSignedCommandAsync — commands that go through the proxy
///     so vehicle-command signs them with the partner private key.
///     Examples: door_lock, set_temps, charge_start, set_sentry_mode,
///     remote_seat_heater_request, schedule_software_update, …
///   * SendRestCommandAsync   — endpoints that the proxy explicitly
///     rejects (`ErrCommandUseRESTAPI`) or that are not part of the
///     signed protocol at all. Examples: wake_up, command/share
///     (navigation_request), vehicle_data, set_managed_*.
///
/// Both helpers share EnsureAwakeAsync, which only fires once per
/// vehicle even if multiple commands are issued concurrently. Tesla
/// rate-limits wake_up to 3/min/vehicle — we MUST not bombard it.
///
/// GetStateAsync respects Tesla's vampire-drain guidance:
///   * never polls automatically;
///   * GET /api/1/vehicles/{id} first (does not wake the car);
///   * GET /api/1/vehicles/{id}/vehicle_data?let_sleep=true only when
///     the car is online or when the caller asks for forceRefresh.
///   * results are cached 30 s per vehicle.
/// </summary>
public sealed class TeslaCommandService
{
    private const int VehicleDataCacheSeconds = 30;
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

    // We only ever want one wake-up in flight per vehicle, even when
    // multiple control buttons are tapped in rapid succession.
    private static readonly ConcurrentDictionary<int, SemaphoreSlim> WakeLocks = new();

    // In-memory snapshot cache. Keyed by TeslaVehicle.Id (TeslaHub-side
    // primary key, NOT the Tesla vehicle id), since the same Tesla VIN
    // could theoretically belong to two TeslaHub installations.
    private static readonly ConcurrentDictionary<int, CachedSnapshot> StateCache = new();

    private readonly AppDbContext _db;
    private readonly TeslaOAuthService _oauth;
    private readonly IHttpClientFactory _httpFactory;
    private readonly ILogger<TeslaCommandService> _logger;
    private readonly string? _proxyBaseUrl;

    public TeslaCommandService(
        AppDbContext db,
        TeslaOAuthService oauth,
        IHttpClientFactory httpFactory,
        IConfiguration configuration,
        ILogger<TeslaCommandService> logger)
    {
        _db = db;
        _oauth = oauth;
        _httpFactory = httpFactory;
        _logger = logger;
        _proxyBaseUrl = configuration["TESLA_COMMAND_PROXY_URL"];
    }

    // ── Public API ───────────────────────────────────────────────────────────

    /// <summary>
    /// Sends a signed Fleet command via the local tesla-http-proxy. The
    /// proxy adds the EC partner-key signature on top of the user's
    /// bearer token before forwarding to fleet-api.prd.<region>.
    /// If the car is asleep we fire wake_up once and retry the command.
    /// </summary>
    public Task<CommandResult> SendSignedCommandAsync(
        int vehicleId,
        string command,
        object? payload,
        CancellationToken cancellationToken) =>
        ExecuteWithWakeAsync(
            vehicleId,
            (account, vehicle) => SendCommandHttpAsync(account, vehicle, command, payload, signed: true, cancellationToken),
            cancellationToken);

    /// <summary>
    /// Sends a Fleet command that the signed proxy refuses (returns
    /// ErrCommandUseRESTAPI), straight to the public Fleet API. Currently
    /// used for command/share (navigation_request) which Tesla parses
    /// server-side and therefore cannot be end-to-end signed.
    /// </summary>
    public Task<CommandResult> SendRestCommandAsync(
        int vehicleId,
        string command,
        object? payload,
        CancellationToken cancellationToken) =>
        ExecuteWithWakeAsync(
            vehicleId,
            (account, vehicle) => SendCommandHttpAsync(account, vehicle, command, payload, signed: false, cancellationToken),
            cancellationToken);

    /// <summary>
    /// Returns a snapshot of the vehicle state, respecting the
    /// 30s cache and the asleep-skip rule (won't wake the car just to
    /// fetch data unless forceRefresh=true).
    /// </summary>
    public async Task<VehicleStateSnapshot> GetStateAsync(
        int vehicleId,
        bool forceRefresh,
        CancellationToken cancellationToken)
    {
        if (!forceRefresh
            && StateCache.TryGetValue(vehicleId, out var cached)
            && cached.ExpiresAt > DateTimeOffset.UtcNow)
        {
            return cached.Snapshot;
        }

        var (vehicle, account) = await ResolveVehicleAsync(vehicleId, cancellationToken);

        var summary = await FetchVehicleSummaryAsync(account, vehicle, cancellationToken);

        // Honour Tesla's "do not wake just to read" guidance. If the car
        // is asleep we return a partial snapshot built from the summary
        // alone, and the UI shows a "Wake up" button.
        if (!forceRefresh && !string.Equals(summary.State, "online", StringComparison.OrdinalIgnoreCase))
        {
            var partial = new VehicleStateSnapshot
            {
                State = summary.State,
                FetchedAt = DateTimeOffset.UtcNow,
                CapabilitiesUpdated = false,
            };
            StateCache[vehicleId] = new CachedSnapshot(partial, DateTimeOffset.UtcNow.AddSeconds(VehicleDataCacheSeconds));
            return partial;
        }

        var data = await FetchVehicleDataAsync(account, vehicle, letSleep: true, cancellationToken);
        var snapshot = BuildSnapshot(summary.State, data);

        // Persist the freshly observed vehicle_config so the UI can hide
        // unsupported buttons (frunk, rear seat heaters, sun roof, …).
        if (data is not null && data.RootElement.TryGetProperty("response", out var resp)
            && resp.TryGetProperty("vehicle_config", out var vehicleConfig)
            && vehicleConfig.ValueKind == JsonValueKind.Object)
        {
            try
            {
                var raw = vehicleConfig.GetRawText();
                if (vehicle.CapabilitiesJson != raw)
                {
                    vehicle.CapabilitiesJson = raw;
                    vehicle.UpdatedAt = DateTime.UtcNow;
                    await _db.SaveChangesAsync(cancellationToken);
                    snapshot.CapabilitiesUpdated = true;
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to persist vehicle_config for vehicle {VehicleId}", vehicleId);
            }
        }

        StateCache[vehicleId] = new CachedSnapshot(snapshot, DateTimeOffset.UtcNow.AddSeconds(VehicleDataCacheSeconds));
        return snapshot;
    }

    /// <summary>
    /// Force a wake_up + wait online. Used both internally before a
    /// command retry and by the explicit "Wake" button on the UI.
    /// Safe to call concurrently — only one wake per vehicle in flight.
    /// </summary>
    public Task<WakeOutcome> EnsureAwakeAsync(int vehicleId, CancellationToken cancellationToken) =>
        EnsureAwakeInternalAsync(vehicleId, cancellationToken);

    // ── Core helpers ─────────────────────────────────────────────────────────

    private async Task<CommandResult> ExecuteWithWakeAsync(
        int vehicleId,
        Func<TeslaAccount, TeslaVehicle, Task<CommandResult>> action,
        CancellationToken cancellationToken)
    {
        var (vehicle, account) = await ResolveVehicleAsync(vehicleId, cancellationToken);

        var first = await action(account, vehicle);
        if (first.Success || !ShouldRetryAfterWake(first.FailureKind))
            return first;

        _logger.LogInformation(
            "Vehicle {VehicleId} ({Vin}) appears to be asleep ({Kind}). Sending wake_up and retrying once.",
            vehicle.Id, vehicle.Vin, first.FailureKind);

        var wake = await EnsureAwakeInternalAsync(vehicleId, cancellationToken);
        if (!wake.Awoken)
        {
            return CommandResult.Fail(
                CommandFailureKind.VehicleUnreachable,
                wake.Detail ?? "Vehicle did not wake in time.");
        }

        var second = await action(account, vehicle);
        return second with { WokeUp = true };
    }

    private async Task<CommandResult> SendCommandHttpAsync(
        TeslaAccount account,
        TeslaVehicle vehicle,
        string command,
        object? payload,
        bool signed,
        CancellationToken cancellationToken)
    {
        var token = _oauth.DecryptAccessToken(account);

        var useProxy = signed && !string.IsNullOrWhiteSpace(_proxyBaseUrl);

        var endpointBase = useProxy
            ? _proxyBaseUrl!.TrimEnd('/')
            : account.Audience.TrimEnd('/');

        // The signed tesla-http-proxy REQUIRES a 17-character VIN in the
        // command path (it uses it to look up the in-vehicle session
        // keys). Fleet API ID is rejected with HTTP 404. The proxy
        // source (pkg/proxy/proxy.go ~ line 315) is explicit about it.
        // The plain Fleet REST API accepts either VIN or numeric id, but
        // since VIN works in both cases we use it whenever we route to
        // the proxy and keep the numeric id for direct REST (it matches
        // what TeslaShareService and the wake/status code already use).
        var vehicleSegment = useProxy
            ? vehicle.Vin
            : vehicle.TeslaVehicleId.ToString();

        // Some commands are not under /command/* (wake_up, share is, but
        // the endpoint may be passed in already-formed). Accept both.
        var path = command.StartsWith("/", StringComparison.Ordinal)
            ? command
            : $"/api/1/vehicles/{vehicleSegment}/command/{command}";

        var url = endpointBase + path;
        using var http = new HttpRequestMessage(HttpMethod.Post, url);
        if (payload is not null)
            http.Content = JsonContent.Create(payload);
        http.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        http.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));

        // The proxy uses a self-signed cert by default, only the
        // "tesla-proxy" client trusts it. Direct Tesla calls keep
        // strict TLS via the "tesla" client.
        var clientName = signed && !string.IsNullOrWhiteSpace(_proxyBaseUrl) ? "tesla-proxy" : "tesla";
        var client = _httpFactory.CreateClient(clientName);

        try
        {
            using var response = await client.SendAsync(http, cancellationToken);
            var body = await response.Content.ReadAsStringAsync(cancellationToken);

            if (!response.IsSuccessStatusCode)
            {
                _logger.LogWarning(
                    "Tesla command {Command} returned {StatusCode} for vehicle {VehicleId} ({Vin}): {Body}",
                    command, response.StatusCode, vehicle.Id, vehicle.Vin, Truncate(body, 500));
                var kind = ClassifyHttpFailure(response.StatusCode, body);
                return CommandResult.Fail(kind, BuildHttpErrorDetail(response.StatusCode, body, kind));
            }

            var teslaResult = TryParseTeslaResponse(body);
            if (teslaResult is { Result: false })
            {
                _logger.LogInformation(
                    "Tesla rejected command {Command} for vehicle {VehicleId} ({Vin}): {Reason}",
                    command, vehicle.Id, vehicle.Vin, teslaResult.Reason);

                var rejectedKind = LooksLikeAsleep(teslaResult.Reason)
                    ? CommandFailureKind.VehicleUnreachable
                    : CommandFailureKind.Rejected;
                return CommandResult.Fail(rejectedKind, teslaResult.Reason ?? "Tesla rejected the command.");
            }

            return CommandResult.Ok();
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogError(ex, "Failed to send command {Command} for vehicle {VehicleId}", command, vehicle.Id);
            return CommandResult.Fail(CommandFailureKind.Transport, ex.Message);
        }
    }

    private async Task<WakeOutcome> EnsureAwakeInternalAsync(int vehicleId, CancellationToken cancellationToken)
    {
        var lockObj = WakeLocks.GetOrAdd(vehicleId, _ => new SemaphoreSlim(1, 1));
        await lockObj.WaitAsync(cancellationToken);
        try
        {
            var (vehicle, account) = await ResolveVehicleAsync(vehicleId, cancellationToken);
            var token = _oauth.DecryptAccessToken(account);
            var client = _httpFactory.CreateClient("tesla");
            var baseUrl = account.Audience.TrimEnd('/');
            var statusUrl = $"{baseUrl}/api/1/vehicles/{vehicle.TeslaVehicleId}";

            // Skip wake if the car is already online — saves a Fleet
            // call and keeps us within the 3 wakes/min/vehicle limit.
            try
            {
                using var preCheck = new HttpRequestMessage(HttpMethod.Get, statusUrl);
                preCheck.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
                preCheck.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
                using var preCheckResponse = await client.SendAsync(preCheck, cancellationToken);
                if (preCheckResponse.IsSuccessStatusCode)
                {
                    var body = await preCheckResponse.Content.ReadAsStringAsync(cancellationToken);
                    if (string.Equals(ExtractState(body), "online", StringComparison.OrdinalIgnoreCase))
                        return new WakeOutcome(true, null);
                }
            }
            catch
            {
                // ignore — we'll just attempt the wake.
            }

            var wakeUrl = $"{baseUrl}/api/1/vehicles/{vehicle.TeslaVehicleId}/wake_up";
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

            // Progressive back-off poll. Tesla docs say wake takes 10-60s.
            var deadline = DateTimeOffset.UtcNow + WakeMaxWait;
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
                        if (string.Equals(ExtractState(body), "online", StringComparison.OrdinalIgnoreCase))
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
                    // ignore intermittent errors — we will retry
                }
            }

            _logger.LogWarning(
                "Vehicle {VehicleId} ({Vin}) did not become online within {Seconds}s.",
                vehicle.Id, vehicle.Vin, WakeMaxWait.TotalSeconds);
            return new WakeOutcome(false,
                $"Vehicle did not come online within {(int)WakeMaxWait.TotalSeconds}s after wake_up.");
        }
        finally
        {
            lockObj.Release();
        }
    }

    // ── Reads ────────────────────────────────────────────────────────────────

    private async Task<VehicleSummary> FetchVehicleSummaryAsync(
        TeslaAccount account,
        TeslaVehicle vehicle,
        CancellationToken cancellationToken)
    {
        var token = _oauth.DecryptAccessToken(account);
        var client = _httpFactory.CreateClient("tesla");
        var url = $"{account.Audience.TrimEnd('/')}/api/1/vehicles/{vehicle.TeslaVehicleId}";

        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));

        try
        {
            using var response = await client.SendAsync(request, cancellationToken);
            if (!response.IsSuccessStatusCode)
            {
                _logger.LogWarning("vehicle summary returned {StatusCode} for {VehicleId}", response.StatusCode, vehicle.Id);
                return new VehicleSummary(null);
            }
            var body = await response.Content.ReadAsStringAsync(cancellationToken);
            return new VehicleSummary(ExtractState(body));
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogWarning(ex, "vehicle summary fetch failed for {VehicleId}", vehicle.Id);
            return new VehicleSummary(null);
        }
    }

    private async Task<JsonDocument?> FetchVehicleDataAsync(
        TeslaAccount account,
        TeslaVehicle vehicle,
        bool letSleep,
        CancellationToken cancellationToken)
    {
        var token = _oauth.DecryptAccessToken(account);
        var client = _httpFactory.CreateClient("tesla");

        // let_sleep=true asks Tesla to NOT prevent the car from sleeping
        // because of this read. The endpoints query reduces payload size
        // and is the explicitly recommended way per Fleet API docs.
        var query = letSleep
            ? "?let_sleep=true&endpoints=charge_state%3Bclimate_state%3Bvehicle_state%3Bvehicle_config%3Bdrive_state"
            : "?endpoints=charge_state%3Bclimate_state%3Bvehicle_state%3Bvehicle_config%3Bdrive_state";
        var url = $"{account.Audience.TrimEnd('/')}/api/1/vehicles/{vehicle.TeslaVehicleId}/vehicle_data{query}";

        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));

        try
        {
            using var response = await client.SendAsync(request, cancellationToken);
            var body = await response.Content.ReadAsStringAsync(cancellationToken);
            if (!response.IsSuccessStatusCode)
            {
                _logger.LogWarning("vehicle_data returned {StatusCode} for {VehicleId}: {Body}",
                    response.StatusCode, vehicle.Id, Truncate(body, 240));
                return null;
            }
            return JsonDocument.Parse(body);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogWarning(ex, "vehicle_data fetch failed for {VehicleId}", vehicle.Id);
            return null;
        }
    }

    // ── Resolve / load ───────────────────────────────────────────────────────

    private async Task<(TeslaVehicle vehicle, TeslaAccount account)> ResolveVehicleAsync(
        int vehicleId, CancellationToken cancellationToken)
    {
        var vehicle = await _db.Set<TeslaVehicle>()
            .Include(v => v.TeslaAccount)
            .FirstOrDefaultAsync(v => v.Id == vehicleId, cancellationToken)
            ?? throw new TeslaCommandException(
                CommandFailureKind.VehicleNotFound,
                "Vehicle not registered in TeslaHub. Sync vehicles in Settings.");

        if (vehicle.TeslaAccount is null)
            throw new TeslaCommandException(
                CommandFailureKind.NotConfigured,
                "Tesla account not connected. Configure Fleet API in Settings.");

        if (!vehicle.KeyPaired)
            throw new TeslaCommandException(
                CommandFailureKind.KeyNotPaired,
                "Virtual key not paired with this vehicle. Pair it from Settings.");

        var account = await _oauth.EnsureValidAccessTokenAsync(vehicle.TeslaAccount, cancellationToken);
        return (vehicle, account);
    }

    // ── Snapshot extraction (defensive — Tesla loves to add fields) ──────────

    private static VehicleStateSnapshot BuildSnapshot(string? state, JsonDocument? data)
    {
        var snapshot = new VehicleStateSnapshot
        {
            State = state,
            FetchedAt = DateTimeOffset.UtcNow,
        };

        if (data is null) return snapshot;
        if (!data.RootElement.TryGetProperty("response", out var resp)) return snapshot;

        if (resp.TryGetProperty("display_name", out var dn) && dn.ValueKind == JsonValueKind.String)
            snapshot.DisplayName = dn.GetString();

        if (resp.TryGetProperty("vehicle_config", out var vc) && vc.ValueKind == JsonValueKind.Object)
            snapshot.VehicleConfigJson = vc.GetRawText();

        if (resp.TryGetProperty("charge_state", out var cs) && cs.ValueKind == JsonValueKind.Object)
            snapshot.ChargeStateJson = cs.GetRawText();

        if (resp.TryGetProperty("climate_state", out var cl) && cl.ValueKind == JsonValueKind.Object)
            snapshot.ClimateStateJson = cl.GetRawText();

        if (resp.TryGetProperty("vehicle_state", out var vs) && vs.ValueKind == JsonValueKind.Object)
            snapshot.VehicleStateJson = vs.GetRawText();

        if (resp.TryGetProperty("drive_state", out var ds) && ds.ValueKind == JsonValueKind.Object)
            snapshot.DriveStateJson = ds.GetRawText();

        return snapshot;
    }

    // ── Pure helpers ─────────────────────────────────────────────────────────

    private static bool ShouldRetryAfterWake(CommandFailureKind kind) =>
        kind is CommandFailureKind.VehicleUnreachable;

    private static bool LooksLikeAsleep(string? reason) =>
        reason is not null && (
            reason.Contains("vehicle unavailable", StringComparison.OrdinalIgnoreCase) ||
            reason.Contains("vehicle is asleep", StringComparison.OrdinalIgnoreCase) ||
            reason.Contains("vehicle is offline", StringComparison.OrdinalIgnoreCase) ||
            reason.Contains("offline or asleep", StringComparison.OrdinalIgnoreCase));

    private static CommandFailureKind ClassifyHttpFailure(System.Net.HttpStatusCode status, string body)
    {
        // Tesla's signed proxy returns 500 with the body
        //   {"response":null,"error":"vehicle unavailable: vehicle is offline or asleep","error_description":""}
        // when the car is sleeping. The naive (int)status switch would
        // map 500 to Transport (no retry), so the wake_up + retry path
        // would never fire. Sniff the body first so we surface this as
        // VehicleUnreachable, which ShouldRetryAfterWake handles.
        if (LooksLikeAsleep(body))
            return CommandFailureKind.VehicleUnreachable;

        return (int)status switch
        {
            400 => CommandFailureKind.InvalidRequest,
            401 or 403 => CommandFailureKind.Unauthorized,
            404 => CommandFailureKind.VehicleNotFound,
            408 or 504 => CommandFailureKind.VehicleUnreachable,
            429 => CommandFailureKind.RateLimited,
            _ when (int)status >= 500 => CommandFailureKind.Transport,
            _ => CommandFailureKind.Rejected,
        };
    }

    private static string BuildHttpErrorDetail(System.Net.HttpStatusCode status, string body, CommandFailureKind kind)
    {
        var snippet = Truncate(body, 240);
        return kind switch
        {
            CommandFailureKind.Unauthorized =>
                "Tesla refused the request. Reconnect your Tesla account in Settings.",
            CommandFailureKind.VehicleUnreachable =>
                "The vehicle did not respond in time. It may be offline — try again in a moment.",
            CommandFailureKind.RateLimited =>
                "Tesla rate-limit hit. Wait a moment before retrying.",
            CommandFailureKind.Transport =>
                $"Tesla service error ({(int)status}). Try again later.",
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

    private static string? ExtractState(string body)
    {
        try
        {
            using var doc = JsonDocument.Parse(body);
            if (doc.RootElement.TryGetProperty("response", out var resp)
                && resp.TryGetProperty("state", out var st)
                && st.ValueKind == JsonValueKind.String)
                return st.GetString();
        }
        catch
        {
            // ignore
        }
        return null;
    }

    private static string Truncate(string value, int max) =>
        value.Length <= max ? value : value[..max] + "…";

    private sealed record CachedSnapshot(VehicleStateSnapshot Snapshot, DateTimeOffset ExpiresAt);

    private sealed record VehicleSummary(string? State);

    private sealed record TeslaCommandResponse(bool Result, string? Reason);
}

// ── Public DTOs / errors ─────────────────────────────────────────────────────

public enum CommandFailureKind
{
    None = 0,
    InvalidRequest,
    NotConfigured,
    VehicleNotFound,
    KeyNotPaired,
    Unauthorized,
    Rejected,
    VehicleUnreachable,
    RateLimited,
    Transport,
}

public sealed record CommandResult(
    bool Success,
    string? Error,
    CommandFailureKind FailureKind,
    bool WokeUp = false)
{
    public static CommandResult Ok() => new(true, null, CommandFailureKind.None);
    public static CommandResult Fail(CommandFailureKind kind, string error) => new(false, error, kind);
}

public sealed record WakeOutcome(bool Awoken, string? Detail);

public sealed class TeslaCommandException : Exception
{
    public CommandFailureKind FailureKind { get; }

    public TeslaCommandException(CommandFailureKind kind, string message) : base(message)
    {
        FailureKind = kind;
    }
}

/// <summary>
/// In-memory snapshot of a vehicle's state. The various *Json fields
/// are kept as raw JSON strings so the API layer can ship them straight
/// to the SPA without re-binding into a tightly-coupled C# DTO. The
/// SPA already has typed React components that consume the same shapes.
/// </summary>
public sealed class VehicleStateSnapshot
{
    public string? State { get; set; }
    public string? DisplayName { get; set; }
    public string? VehicleConfigJson { get; set; }
    public string? ChargeStateJson { get; set; }
    public string? ClimateStateJson { get; set; }
    public string? VehicleStateJson { get; set; }
    public string? DriveStateJson { get; set; }
    public DateTimeOffset FetchedAt { get; set; }
    public bool CapabilitiesUpdated { get; set; }
}
