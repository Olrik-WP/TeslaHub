using TeslaHub.Api.Services;
using TeslaHub.Api.TeslaMate;

namespace TeslaHub.Api.Endpoints;

public static class ChargingEndpoints
{
    public static void MapChargingEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/charging").RequireAuthorization();

        group.MapGet("/{carId:int}", async (int carId, int? limit, int? offset, TeslaMateConnectionFactory tm, CacheService cache) =>
        {
            var l = limit ?? 20;
            var o = offset ?? 0;
            var sessions = await cache.GetOrSetHistoricalAsync(
                $"charging:{carId}:{l}:{o}",
                () => tm.GetChargingSessionsAsync(carId, l, o));
            return Results.Ok(sessions);
        });

        group.MapGet("/{carId:int}/{chargingProcessId:int}/points", async (int carId, int chargingProcessId, TeslaMateConnectionFactory tm, CacheService cache) =>
        {
            var points = await cache.GetOrSetHistoricalAsync(
                $"chargePoints:{chargingProcessId}",
                () => tm.GetChargePointsAsync(chargingProcessId));
            return Results.Ok(points);
        });

        group.MapGet("/geofences", async (TeslaMateConnectionFactory tm, CacheService cache) =>
        {
            var geofences = await cache.GetOrSetStaticAsync("geofences", tm.GetGeofencesAsync);
            return Results.Ok(geofences);
        });
    }
}
