using TeslaHub.Api.Services;
using TeslaHub.Api.TeslaMate;

namespace TeslaHub.Api.Endpoints;

public static class MapEndpoints
{
    public static void MapMapEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/map").RequireAuthorization();

        group.MapGet("/recent/{carId:int}", async (int carId, int? hours, DateTime? from, DateTime? to, TeslaMateConnectionFactory tm, CacheService cache) =>
        {
            if (from.HasValue && to.HasValue)
            {
                var positions = await cache.GetOrSetLiveAsync(
                    $"recentPositions:{carId}:{from:yyyyMMddHH}:{to:yyyyMMddHH}",
                    () => tm.GetPositionsInRangeAsync(carId, from.Value, to.Value));
                return Results.Ok(positions);
            }
            else
            {
                var h = hours ?? 24;
                var positions = await cache.GetOrSetLiveAsync(
                    $"recentPositions:{carId}:{h}",
                    () => tm.GetRecentPositionsAsync(carId, h));
                return Results.Ok(positions);
            }
        });

        group.MapGet("/stats/{carId:int}", async (int carId, DateTime? from, DateTime? to, TeslaMateConnectionFactory tm, CacheService cache) =>
        {
            var fromDate = from ?? DateTime.UtcNow.AddDays(-30);
            var toDate = to ?? DateTime.UtcNow;
            var stats = await cache.GetOrSetHistoricalAsync(
                $"stats:{carId}:{fromDate:yyyyMMdd}:{toDate:yyyyMMdd}",
                () => tm.GetStatsAsync(carId, fromDate, toDate));
            return Results.Ok(stats);
        });
    }
}
