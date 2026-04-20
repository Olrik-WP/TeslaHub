using System.Globalization;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Caching.Memory;

namespace TeslaHub.Api.Services;

/// <summary>
/// Thin proxy in front of the public Open Charge Map (OCM) API.
///
/// OCM (https://openchargemap.org) is an open-data community catalog of
/// public EV charging stations worldwide — the same dataset most third-party
/// EV apps rely on. It includes Tesla Superchargers, Tesla Destination
/// Charging, Ionity, Fastned, TotalEnergies, Allego, and pretty much every
/// other operator a Tesla driver might use.
///
/// We do the request server-side rather than from the browser so we can:
///   • cache responses (rate limits without an OCM key are tight),
///   • hide the optional OCM API key,
///   • normalise the (verbose) OCM payload into a small DTO.
///
/// Cache strategy: results are keyed by a coarse bbox (snapped to 0.5°
/// tiles) plus the network filter. A typical city pan stays inside one
/// tile so cache hits are frequent. Entries live ~24h.
///
/// Endpoint contract reference: openchargemap/ocm-docs OpenAPI spec
/// (https://github.com/openchargemap/ocm-docs).
/// </summary>
public sealed class ChargersService
{
    private const string OcmEndpoint = "https://api.openchargemap.io/v3/poi";

    // Snap bbox edges to this grid (degrees). 0.5° is roughly 55 km N-S,
    // wide enough that a normal pan stays inside one tile, narrow enough
    // that a single tile rarely tops the OCM `maxresults` cap.
    private const double TileDegrees = 0.5;

    // Cap returned per-bbox; aligned with what the UI clusters comfortably.
    private const int MaxResultsPerCall = 500;

    private static readonly TimeSpan CacheDuration = TimeSpan.FromHours(24);

    private readonly IHttpClientFactory _httpFactory;
    private readonly IMemoryCache _cache;
    private readonly ILogger<ChargersService> _logger;
    private readonly string? _envApiKey;

    public ChargersService(
        IHttpClientFactory httpFactory,
        IMemoryCache cache,
        IConfiguration configuration,
        ILogger<ChargersService> logger)
    {
        _httpFactory = httpFactory;
        _cache = cache;
        _logger = logger;
        // Env-var fallback. The settings-stored key (passed at request time)
        // takes precedence — see GetChargersAsync.
        _envApiKey = configuration["OCM_API_KEY"];
    }

    /// <summary>
    /// Fetch charging stations inside the given bbox, optionally filtered
    /// by network names (case-insensitive match against OCM operator title)
    /// and/or by minimum charging power.
    ///
    /// The result is wrapped in <see cref="ChargersResult"/> so the frontend
    /// can distinguish "OCM blocked us" (no key, expired key, throttled) from
    /// "no chargers in this bbox" — both look like an empty list otherwise.
    /// </summary>
    public async Task<ChargersResult> GetChargersAsync(
        double south,
        double west,
        double north,
        double east,
        IReadOnlyCollection<string>? networkFilter,
        int minPowerKw,
        string? apiKeyOverride,
        CancellationToken cancellationToken)
    {
        if (south >= north || west >= east)
            return ChargersResult.Empty;

        // Settings-stored key wins over the env-var fallback.
        var apiKey = !string.IsNullOrWhiteSpace(apiKeyOverride) ? apiKeyOverride : _envApiKey;
        var hasKey = !string.IsNullOrWhiteSpace(apiKey);

        // Snap to tile grid for cache-friendliness.
        var tileSouth = Math.Floor(south / TileDegrees) * TileDegrees;
        var tileWest = Math.Floor(west / TileDegrees) * TileDegrees;
        var tileNorth = Math.Ceiling(north / TileDegrees) * TileDegrees;
        var tileEast = Math.Ceiling(east / TileDegrees) * TileDegrees;

        // OCM caps the bbox area: very large ones return truncated data.
        // Split the snapped bbox into ≤2°×2° sub-tiles and merge.
        const double MaxTileSpan = 2.0;
        var tasks = new List<Task<TileResult>>();
        for (var lat = tileSouth; lat < tileNorth; lat += MaxTileSpan)
        {
            for (var lng = tileWest; lng < tileEast; lng += MaxTileSpan)
            {
                var subSouth = lat;
                var subNorth = Math.Min(lat + MaxTileSpan, tileNorth);
                var subWest = lng;
                var subEast = Math.Min(lng + MaxTileSpan, tileEast);
                tasks.Add(FetchTileAsync(subSouth, subWest, subNorth, subEast, apiKey, cancellationToken));
            }
        }

        var results = await Task.WhenAll(tasks);

        // De-dupe by ID across overlapping sub-tiles. Track the worst warning
        // we saw — if any tile failed with auth/quota the whole bbox is
        // effectively partial, and the UI should surface the cause.
        var byId = new Dictionary<long, ChargerDto>();
        ChargersWarning? worstWarning = null;
        foreach (var batch in results)
        {
            foreach (var charger in batch.Items)
            {
                byId[charger.Id] = charger;
            }
            if (batch.Warning is { } w && (worstWarning is null || w > worstWarning))
                worstWarning = w;
        }

        // Promote a transport-level "error" to "missing-key" when the user
        // has no key configured — that's almost always the actual cause
        // (OCM started returning 403 to keyless calls in 2024).
        if (worstWarning == ChargersWarning.Error && !hasKey)
            worstWarning = ChargersWarning.MissingKey;

        IEnumerable<ChargerDto> filtered = byId.Values.Where(c =>
            c.Latitude >= south && c.Latitude <= north &&
            c.Longitude >= west && c.Longitude <= east);

        if (networkFilter is { Count: > 0 })
        {
            var filterSet = new HashSet<string>(
                networkFilter.Select(n => n.Trim()).Where(n => !string.IsNullOrEmpty(n)),
                StringComparer.OrdinalIgnoreCase);

            // Loose match: "Tesla" matches "Tesla Supercharger",
            // "Tesla Destination Charger", etc.
            filtered = filtered.Where(c =>
            {
                if (string.IsNullOrEmpty(c.Network)) return false;
                foreach (var f in filterSet)
                {
                    if (c.Network.Contains(f, StringComparison.OrdinalIgnoreCase))
                        return true;
                }
                return false;
            });
        }

        if (minPowerKw > 0)
        {
            // Keep stations whose best-known connector reaches the threshold.
            // Stations with no declared power are dropped (otherwise the
            // filter would be misleading).
            filtered = filtered.Where(c => c.PowerKw is { } p && p >= minPowerKw);
        }

        var items = filtered
            .OrderByDescending(c => c.PowerKw ?? 0)
            .Take(MaxResultsPerCall)
            .ToArray();

        return new ChargersResult
        {
            Items = items,
            Warning = worstWarning?.ToWireString(),
        };
    }

    private async Task<TileResult> FetchTileAsync(
        double south,
        double west,
        double north,
        double east,
        string? apiKey,
        CancellationToken cancellationToken)
    {
        // The cache key purposely ignores the API key: the OCM payload for
        // a given bbox is identical with or without a key (only the rate
        // limit differs), so different users / config changes can share the
        // same cached entry.
        var cacheKey = $"chargers:{south:F2}:{west:F2}:{north:F2}:{east:F2}";
        if (_cache.TryGetValue(cacheKey, out IReadOnlyList<ChargerDto>? cached) && cached is not null)
            return new TileResult(cached, null);

        // verbose=true keeps the nested OperatorInfo / ConnectionType / UsageType
        // / StatusType / DataProvider objects so we can read their Title.
        // compact is left to its default (false) for the same reason.
        var inv = CultureInfo.InvariantCulture;
        var url =
            $"{OcmEndpoint}?output=json" +
            $"&boundingbox=({south.ToString(inv)},{west.ToString(inv)}),({north.ToString(inv)},{east.ToString(inv)})" +
            $"&maxresults={MaxResultsPerCall}&verbose=true";

        try
        {
            var client = _httpFactory.CreateClient("ocm");
            using var request = new HttpRequestMessage(HttpMethod.Get, url);
            request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
            if (!string.IsNullOrWhiteSpace(apiKey))
            {
                request.Headers.Add("X-API-Key", apiKey);
            }

            using var response = await client.SendAsync(request, cancellationToken);
            if (!response.IsSuccessStatusCode)
            {
                _logger.LogWarning(
                    "OCM returned {StatusCode} for tile ({S},{W})-({N},{E}); skipping",
                    response.StatusCode, south, west, north, east);

                // Map HTTP status to a typed warning so the UI can give the
                // user actionable feedback (add a key, slow down, etc.). We
                // do *not* cache failures — the next request might succeed
                // (e.g. user just added a key in Settings).
                var warning = (int)response.StatusCode switch
                {
                    401 or 403 => ChargersWarning.MissingKey,
                    429 => ChargersWarning.RateLimited,
                    _ => ChargersWarning.Error,
                };
                return new TileResult(Array.Empty<ChargerDto>(), warning);
            }

            var payload = await response.Content.ReadAsStringAsync(cancellationToken);
            var poiList = JsonSerializer.Deserialize<List<OcmPoi>>(payload, JsonOptions) ?? new();

            var dtos = poiList
                .Where(p => p.AddressInfo?.Latitude != null && p.AddressInfo?.Longitude != null)
                .Select(MapToDto)
                .ToArray();

            _cache.Set(cacheKey, (IReadOnlyList<ChargerDto>)dtos, new MemoryCacheEntryOptions
            {
                AbsoluteExpirationRelativeToNow = CacheDuration,
                Size = Math.Max(1, dtos.Length),
            });

            return new TileResult(dtos, null);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogError(ex, "Failed to fetch chargers from Open Charge Map");
            return new TileResult(Array.Empty<ChargerDto>(), ChargersWarning.Error);
        }
    }

    private readonly record struct TileResult(IReadOnlyList<ChargerDto> Items, ChargersWarning? Warning);

    private static ChargerDto MapToDto(OcmPoi poi)
    {
        var network = poi.OperatorInfo?.Title?.Trim();
        if (string.IsNullOrEmpty(network)) network = "Unknown operator";
        var category = ClassifyNetwork(network);

        var connections = poi.Connections?
            .Where(c => c.ConnectionType?.Title != null || c.PowerKw != null)
            .Select(c => new ChargerConnection
            {
                Type = c.ConnectionType?.Title?.Trim() ?? "Unknown",
                PowerKw = c.PowerKw,
                CurrentType = c.CurrentType?.Title?.Trim(),
                Quantity = c.Quantity ?? 1,
            })
            .ToArray() ?? Array.Empty<ChargerConnection>();

        var maxPower = connections
            .Where(c => c.PowerKw != null)
            .Select(c => c.PowerKw!.Value)
            .DefaultIfEmpty(0d)
            .Max();

        return new ChargerDto
        {
            Id = poi.Id,
            Latitude = poi.AddressInfo!.Latitude!.Value,
            Longitude = poi.AddressInfo!.Longitude!.Value,
            Title = poi.AddressInfo.Title?.Trim() ?? network,
            Network = network,
            OperatorWebsite = poi.OperatorInfo?.WebsiteURL,
            Category = category,
            PowerKw = maxPower > 0 ? maxPower : null,
            ConnectorCount = connections.Sum(c => c.Quantity),
            Connections = connections,
            Address = poi.AddressInfo.AddressLine1,
            City = poi.AddressInfo.Town,
            UsageType = poi.UsageType?.Title,
            OperationalStatus = poi.StatusType?.Title,
            IsOperational = poi.StatusType?.IsOperational ?? true,
        };
    }

    private static string ClassifyNetwork(string network)
    {
        if (network.Contains("Tesla Supercharger", StringComparison.OrdinalIgnoreCase) ||
            network.Equals("Tesla", StringComparison.OrdinalIgnoreCase))
            return "tesla-supercharger";
        if (network.Contains("Tesla", StringComparison.OrdinalIgnoreCase))
            return "tesla-destination";
        return "third-party";
    }

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    // ── Inbound OCM payload ─────────────────────────────────────────────

    private sealed class OcmPoi
    {
        [JsonPropertyName("ID")] public long Id { get; set; }
        [JsonPropertyName("AddressInfo")] public OcmAddressInfo? AddressInfo { get; set; }
        [JsonPropertyName("OperatorInfo")] public OcmOperator? OperatorInfo { get; set; }
        [JsonPropertyName("UsageType")] public OcmTitled? UsageType { get; set; }
        [JsonPropertyName("StatusType")] public OcmStatusType? StatusType { get; set; }
        [JsonPropertyName("Connections")] public List<OcmConnection>? Connections { get; set; }
    }

    private sealed class OcmAddressInfo
    {
        [JsonPropertyName("Title")] public string? Title { get; set; }
        [JsonPropertyName("AddressLine1")] public string? AddressLine1 { get; set; }
        [JsonPropertyName("Town")] public string? Town { get; set; }
        [JsonPropertyName("Latitude")] public double? Latitude { get; set; }
        [JsonPropertyName("Longitude")] public double? Longitude { get; set; }
    }

    private sealed class OcmOperator
    {
        [JsonPropertyName("Title")] public string? Title { get; set; }
        [JsonPropertyName("WebsiteURL")] public string? WebsiteURL { get; set; }
    }

    private sealed class OcmTitled
    {
        [JsonPropertyName("Title")] public string? Title { get; set; }
    }

    private sealed class OcmStatusType
    {
        [JsonPropertyName("Title")] public string? Title { get; set; }
        [JsonPropertyName("IsOperational")] public bool? IsOperational { get; set; }
    }

    private sealed class OcmConnection
    {
        [JsonPropertyName("ConnectionType")] public OcmTitled? ConnectionType { get; set; }
        [JsonPropertyName("CurrentType")] public OcmTitled? CurrentType { get; set; }
        [JsonPropertyName("PowerKW")] public double? PowerKw { get; set; }
        [JsonPropertyName("Quantity")] public int? Quantity { get; set; }
    }
}

public sealed record ChargerDto
{
    public long Id { get; init; }
    public double Latitude { get; init; }
    public double Longitude { get; init; }
    public string Title { get; init; } = string.Empty;
    public string Network { get; init; } = string.Empty;
    public string? OperatorWebsite { get; init; }
    /// <summary>
    /// "tesla-supercharger" | "tesla-destination" | "third-party". Used by
    /// the frontend to label Tesla-branded sites. The actual marker colour
    /// is driven by <see cref="PowerKw"/>.
    /// </summary>
    public string Category { get; init; } = "third-party";
    /// <summary>Highest declared per-connector power across the site, in kW.</summary>
    public double? PowerKw { get; init; }
    public int ConnectorCount { get; init; }
    public ChargerConnection[] Connections { get; init; } = Array.Empty<ChargerConnection>();
    public string? Address { get; init; }
    public string? City { get; init; }
    public string? UsageType { get; init; }
    public string? OperationalStatus { get; init; }
    public bool IsOperational { get; init; } = true;
}

public sealed record ChargerConnection
{
    public string Type { get; init; } = string.Empty;
    public double? PowerKw { get; init; }
    public string? CurrentType { get; init; }
    public int Quantity { get; init; } = 1;
}

/// <summary>
/// Wrapped chargers response. <see cref="Warning"/> is non-null when the
/// upstream OCM call failed (or returned partial data), and the frontend
/// should surface that to the user instead of silently showing 0 markers.
/// </summary>
public sealed record ChargersResult
{
    public IReadOnlyList<ChargerDto> Items { get; init; } = Array.Empty<ChargerDto>();

    /// <summary>
    /// One of: <c>"missing-key"</c>, <c>"rate-limited"</c>, <c>"error"</c>,
    /// or <c>null</c> on full success.
    /// </summary>
    public string? Warning { get; init; }

    public static readonly ChargersResult Empty = new();
}

/// <summary>
/// Ordered by severity (worst last): <see cref="GetChargersAsync"/> keeps
/// the highest-severity warning seen across sub-tiles.
/// </summary>
internal enum ChargersWarning
{
    RateLimited = 1,
    Error = 2,
    MissingKey = 3,
}

internal static class ChargersWarningExtensions
{
    public static string ToWireString(this ChargersWarning w) => w switch
    {
        ChargersWarning.MissingKey => "missing-key",
        ChargersWarning.RateLimited => "rate-limited",
        _ => "error",
    };
}
