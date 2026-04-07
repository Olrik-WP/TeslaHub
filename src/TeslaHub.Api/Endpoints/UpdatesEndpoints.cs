using TeslaHub.Api.Services;
using TeslaHub.Api.TeslaMate;

namespace TeslaHub.Api.Endpoints;

public static class UpdatesEndpoints
{
    public static void MapUpdatesEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/updates").RequireAuthorization();

        group.MapGet("/{carId:int}", async (int carId, TeslaMateConnectionFactory tm, CacheService cache) =>
        {
            var items = await cache.GetOrSetHistoricalAsync(
                $"updates:{carId}",
                () => tm.GetUpdatesListAsync(carId));
            var stats = await cache.GetOrSetHistoricalAsync(
                $"updatesStats:{carId}",
                () => tm.GetUpdatesStatsAsync(carId));
            return Results.Ok(new { items, stats });
        });
    }
}
