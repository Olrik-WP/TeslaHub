using TeslaHub.Api.Services;
using TeslaHub.Api.TeslaMate;

namespace TeslaHub.Api.Endpoints;

public static class MileageEndpoints
{
    public static void MapMileageEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/mileage").RequireAuthorization();

        group.MapGet("/{carId:int}", async (int carId, int? days, TeslaMateConnectionFactory tm, CacheService cache) =>
        {
            var d = days ?? 365;
            var data = await cache.GetOrSetHistoricalAsync(
                $"mileage:{carId}:{d}",
                () => tm.GetMileageTimeSeriesAsync(carId, d == 0 ? null : d));
            return Results.Ok(data);
        });
    }
}
