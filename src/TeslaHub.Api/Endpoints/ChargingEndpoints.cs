using TeslaHub.Api.Services;
using TeslaHub.Api.TeslaMate;

namespace TeslaHub.Api.Endpoints;

public static class ChargingEndpoints
{
    public static void MapChargingEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/charging").RequireAuthorization();

        group.MapGet("/{carId:int}", async (int carId, int? limit, int? offset, string? chargeType, TeslaMateConnectionFactory tm, CacheService cache) =>
        {
            var l = limit ?? 20;
            var o = offset ?? 0;
            var ct = chargeType is "AC" or "DC" ? chargeType : null;
            var sessions = await cache.GetOrSetHistoricalAsync(
                $"charging:{carId}:{l}:{o}:{ct}",
                () => tm.GetChargingSessionsAsync(carId, l, o, ct));
            return Results.Ok(sessions);
        });

        group.MapGet("/{carId:int}/{chargingProcessId:int}/points", async (int carId, int chargingProcessId, TeslaMateConnectionFactory tm, CacheService cache) =>
        {
            var points = await cache.GetOrSetHistoricalAsync(
                $"chargePoints:{chargingProcessId}",
                () => tm.GetChargePointsAsync(chargingProcessId));
            return Results.Ok(points);
        });

        group.MapGet("/{carId:int}/stats", async (int carId, TeslaMateConnectionFactory tm, CacheService cache) =>
        {
            var stats = await cache.GetOrSetHistoricalAsync(
                $"chargingStats:{carId}",
                () => tm.GetChargingStatsAsync(carId));
            return Results.Ok(stats);
        });

        group.MapGet("/{carId:int}/summary", async (int carId, int? days, TeslaMateConnectionFactory tm, CacheService cache) =>
        {
            var summary = await cache.GetOrSetHistoricalAsync(
                $"chargingSummary:{carId}:{days}",
                () => tm.GetChargingSummaryAsync(carId, days));
            return Results.Ok(summary);
        });

        group.MapGet("/{carId:int}/curve", async (int carId, TeslaMateConnectionFactory tm, CacheService cache) =>
        {
            var points = await cache.GetOrSetHistoricalAsync(
                $"chargingCurvePoints:{carId}",
                () => tm.GetChargingCurvePointsAsync(carId));
            var median = await cache.GetOrSetHistoricalAsync(
                $"chargingCurveMedian:{carId}",
                () => tm.GetChargingCurveMedianAsync(carId));
            return Results.Ok(new { points, median });
        });

        group.MapGet("/geofences", async (TeslaMateConnectionFactory tm, CacheService cache) =>
        {
            var geofences = await cache.GetOrSetStaticAsync("geofences", tm.GetGeofencesAsync);
            return Results.Ok(geofences);
        });
    }
}
