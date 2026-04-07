using TeslaHub.Api.Services;
using TeslaHub.Api.TeslaMate;

namespace TeslaHub.Api.Endpoints;

public static class BatteryEndpoints
{
    public static void MapBatteryEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/battery").RequireAuthorization();

        group.MapGet("/{carId:int}/health", async (int carId, TeslaMateConnectionFactory tm, CacheService cache) =>
        {
            var data = await cache.GetOrSetHistoricalAsync(
                $"batteryHealth:{carId}",
                () => tm.GetBatteryHealthAsync(carId));
            return Results.Ok(data);
        });

        group.MapGet("/{carId:int}/charge-level", async (int carId, int? days, TeslaMateConnectionFactory tm, CacheService cache) =>
        {
            var d = days ?? 90;
            var data = await cache.GetOrSetHistoricalAsync(
                $"chargeLevel:{carId}:{d}",
                () => tm.GetChargeLevelTimeSeriesAsync(carId, d));
            return Results.Ok(data);
        });

        group.MapGet("/{carId:int}/projected-range", async (int carId, int? days, TeslaMateConnectionFactory tm, CacheService cache) =>
        {
            var d = days ?? 90;
            var data = await cache.GetOrSetHistoricalAsync(
                $"projectedRange:{carId}:{d}",
                () => tm.GetProjectedRangeTimeSeriesAsync(carId, d));
            return Results.Ok(data);
        });
    }
}
