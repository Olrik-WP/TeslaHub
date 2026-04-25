using System.Globalization;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using TeslaHub.Api.Data;
using TeslaHub.Api.Models;

namespace TeslaHub.Api.Services;

/// <summary>
/// Sends a single navigation destination to a paired Tesla via the Fleet
/// API `command/share` endpoint. Tesla parses the address server-side, so
/// this command is one of the few documented as
/// `ErrCommandUseRESTAPI` by the signed proxy — it must therefore be
/// posted as a plain bearer-token REST call. Source:
/// teslamotors/vehicle-command pkg/proxy/command.go (`navigation_request`).
///
/// The wake-and-retry lifecycle is delegated to <see cref="TeslaCommandService"/>
/// so that share, climate, locks, charging and every other command share
/// the exact same logic (single semaphore per vehicle, identical retry
/// classification). This file only carries the share-specific payload and
/// translation rules.
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
    private readonly TeslaCommandService _commands;
    private readonly ILogger<TeslaShareService> _logger;

    public TeslaShareService(
        AppDbContext db,
        TeslaCommandService commands,
        ILogger<TeslaShareService> logger)
    {
        _db = db;
        _commands = commands;
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

        var vehicle = await _db.Set<TeslaVehicle>().FirstOrDefaultAsync(v => v.Id == vehicleId, cancellationToken);
        if (vehicle is null)
            return ShareResult.Fail(ShareFailureKind.VehicleNotFound,
                "Vehicle is not registered in TeslaHub. Sync your vehicles in Settings → Tesla integration.");

        // If the caller passed raw "lat,lng" coordinates (with or without
        // an address line in front), normalise them to a Google Maps URL
        // so Tesla's server-side parser uses the EXACT pin instead of
        // fuzzy-matching a nearby POI from the address line. The web
        // front-end already builds a URL itself; this guard is defence
        // in depth for any other caller (Telegram bot, scripts, …).
        var sharedValue = NormaliseToTeslaUrl(trimmedValue);

        var normalisedLocale = NormalizeLocale(request.Locale);
        var timestampMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds().ToString();

        var payload = new
        {
            type = "share_ext_content_raw",
            value = new Dictionary<string, string>
            {
                ["android.intent.extra.TEXT"] = sharedValue,
            },
            locale = normalisedLocale,
            timestamp_ms = timestampMs,
        };

        try
        {
            var result = await _commands.SendRestCommandAsync(vehicleId, "share", payload, cancellationToken);
            if (result.Success)
            {
                _logger.LogInformation(
                    "Sent destination to vehicle {VehicleId} ({Vin}): {Value}",
                    vehicle.Id, vehicle.Vin, Truncate(sharedValue, 120));
                return ShareResult.Ok(result.WokeUp);
            }

            return ShareResult.Fail(MapKind(result.FailureKind), result.Error ?? "Tesla rejected the destination.");
        }
        catch (TeslaCommandException ex)
        {
            return ShareResult.Fail(MapKind(ex.FailureKind), ex.Message);
        }
    }

    private static ShareFailureKind MapKind(CommandFailureKind kind) => kind switch
    {
        CommandFailureKind.InvalidRequest => ShareFailureKind.InvalidRequest,
        CommandFailureKind.NotConfigured => ShareFailureKind.NotConfigured,
        CommandFailureKind.VehicleNotFound => ShareFailureKind.VehicleNotFound,
        CommandFailureKind.KeyNotPaired => ShareFailureKind.KeyNotPaired,
        CommandFailureKind.Unauthorized => ShareFailureKind.Unauthorized,
        CommandFailureKind.VehicleUnreachable => ShareFailureKind.VehicleUnreachable,
        CommandFailureKind.Rejected => ShareFailureKind.Rejected,
        _ => ShareFailureKind.Transport,
    };

    // Pattern: optional sign, 1-3 integer digits, dot, ≥1 fractional digits
    // for lat AND lng, separated by `,` or `;` with optional whitespace.
    // Anchored loosely so we can spot a coordinate pair sitting on its own
    // line inside a multi-line "Address\nLat,Lng" payload.
    private static readonly Regex CoordinatePairPattern = new(
        @"(?<lat>-?\d{1,3}\.\d+)\s*[,;]\s*(?<lng>-?\d{1,3}\.\d+)",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);

    /// <summary>
    /// Tesla's `command/share` endpoint geocodes the text we send it. If we
    /// hand it raw "Lat,Lng" or "Address\nLat,Lng" it tends to use the
    /// (approximate) address line and ignore the precise coordinates,
    /// landing the navigation destination hundreds of meters off the
    /// actual pin. To force pin-precision, repackage any detected
    /// coordinate pair into a `https://maps.google.com/?q=lat,lng` URL —
    /// the same shape Tesla's iOS share extension produces, which Tesla
    /// firmware reliably parses to the EXACT coordinates.
    /// Anything that already looks like a URL or a plain address (no
    /// coords detected) is forwarded unchanged.
    /// </summary>
    internal static string NormaliseToTeslaUrl(string value)
    {
        if (string.IsNullOrWhiteSpace(value)) return value;

        var trimmed = value.Trim();

        // Already a URL — let Tesla parse it as-is.
        if (trimmed.StartsWith("http://", StringComparison.OrdinalIgnoreCase)
            || trimmed.StartsWith("https://", StringComparison.OrdinalIgnoreCase)
            || trimmed.StartsWith("geo:", StringComparison.OrdinalIgnoreCase))
        {
            return trimmed;
        }

        var match = CoordinatePairPattern.Match(trimmed);
        if (!match.Success) return trimmed;

        if (!double.TryParse(match.Groups["lat"].Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var lat)
            || !double.TryParse(match.Groups["lng"].Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var lng))
        {
            return trimmed;
        }

        if (lat is < -90 or > 90 || lng is < -180 or > 180) return trimmed;

        // Anything that precedes/follows the coordinate match (typically
        // a reverse-geocoded address) is reused as a Google-Maps style
        // label so Tesla shows a friendly destination name instead of
        // raw lat/lng on the central screen.
        var label = (trimmed[..match.Index] + trimmed[(match.Index + match.Length)..])
            .Replace('\n', ' ')
            .Replace('\r', ' ')
            .Trim(' ', ',', ';', '|', '\t');

        var latStr = lat.ToString("0.000000", CultureInfo.InvariantCulture);
        var lngStr = lng.ToString("0.000000", CultureInfo.InvariantCulture);

        if (string.IsNullOrEmpty(label))
            return $"https://maps.google.com/?q={latStr},{lngStr}";

        var encodedLabel = Uri.EscapeDataString(label).Replace("%20", "+");
        return $"https://maps.google.com/?q={latStr},{lngStr}({encodedLabel})";
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

    private static string Truncate(string value, int max) =>
        value.Length <= max ? value : value[..max] + "…";
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
    public static ShareResult Ok(bool wokeUp = false) => new(true, null, ShareFailureKind.None, wokeUp);
    public static ShareResult Fail(ShareFailureKind kind, string error) => new(false, error, kind);
}

public sealed record ShareDestinationRequest(string Value, string? Locale);
