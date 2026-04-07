using TeslaHub.Api.Services;
using TeslaHub.Api.TeslaMate;

namespace TeslaHub.Api.Endpoints;

public static class StatesEndpoints
{
    public static void MapStatesEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/states").RequireAuthorization();

        group.MapGet("/{carId:int}/summary", async (int carId, int? days, TeslaMateConnectionFactory tm, CacheService cache) =>
        {
            var d = days ?? 7;
            var data = await cache.GetOrSetHistoricalAsync(
                $"statesSummary:{carId}:{d}",
                () => tm.GetStatesSummaryAsync(carId, d));
            return Results.Ok(data);
        });

        group.MapGet("/{carId:int}/timeline", async (int carId, int? days, TeslaMateConnectionFactory tm, CacheService cache) =>
        {
            var d = days ?? 7;
            var data = await cache.GetOrSetHistoricalAsync(
                $"timeline:{carId}:{d}",
                () => tm.GetTimelineAsync(carId, d));
            return Results.Ok(data);
        });
    }
}
