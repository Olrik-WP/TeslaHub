using Microsoft.EntityFrameworkCore;
using TeslaHub.Api.Data;
using TeslaHub.Api.Services;

namespace TeslaHub.Api.Endpoints;

/// <summary>
/// Public chargers map layer.
///   GET /api/chargers?south=&west=&north=&east=
///
/// The endpoint resolves the user's network preference from
/// <see cref="Models.GlobalSettings"/> and proxies the bbox query through
/// <see cref="ChargersService"/> (Open Charge Map). Returns an empty array
/// when the feature is disabled in settings — the frontend uses that as a
/// signal to skip rendering the layer entirely.
/// </summary>
public static class ChargersEndpoints
{
    public static void MapChargersEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/chargers").RequireAuthorization();

        group.MapGet("/", async (
            double south,
            double west,
            double north,
            double east,
            AppDbContext db,
            ChargersService chargers,
            CancellationToken ct) =>
        {
            var settings = await db.GlobalSettings.FirstOrDefaultAsync(ct);
            if (settings is null || !settings.ChargersEnabled)
                return Results.Ok(Array.Empty<ChargerDto>());

            var networkFilter = ResolveNetworkFilter(settings.ChargersNetworkFilter, settings.ChargersCustomNetworks);

            var result = await chargers.GetChargersAsync(
                south, west, north, east,
                networkFilter,
                settings.ChargersMinPowerKw,
                settings.ChargersOcmApiKey,
                ct);

            return Results.Ok(result);
        });
    }

    private static IReadOnlyCollection<string>? ResolveNetworkFilter(string filter, string? custom)
    {
        return filter switch
        {
            "all" => null,
            "tesla" => new[] { "Tesla" },
            "custom" when !string.IsNullOrWhiteSpace(custom) =>
                custom.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries),
            _ => null,
        };
    }
}
