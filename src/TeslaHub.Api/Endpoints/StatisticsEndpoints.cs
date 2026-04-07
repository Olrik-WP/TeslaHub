using TeslaHub.Api.Services;
using TeslaHub.Api.TeslaMate;

namespace TeslaHub.Api.Endpoints;

public static class StatisticsEndpoints
{
    public static void MapStatisticsEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/statistics").RequireAuthorization();

        group.MapGet("/{carId:int}", async (int carId, string? period, TeslaMateConnectionFactory tm, CacheService cache) =>
        {
            var p = period ?? "month";
            var data = await cache.GetOrSetHistoricalAsync(
                $"periodicStats:{carId}:{p}",
                () => tm.GetPeriodicStatsAsync(carId, p));
            return Results.Ok(data);
        });
    }
}
