using TeslaHub.Api.Services;
using TeslaHub.Api.TeslaMate;

namespace TeslaHub.Api.Endpoints;

public static class EfficiencyEndpoints
{
    public static void MapEfficiencyEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/efficiency").RequireAuthorization();

        group.MapGet("/{carId:int}", async (int carId, TeslaMateConnectionFactory tm, CacheService cache) =>
        {
            var data = await cache.GetOrSetHistoricalAsync(
                $"efficiency:{carId}",
                () => tm.GetEfficiencySummaryAsync(carId));
            return Results.Ok(data);
        });
    }
}
