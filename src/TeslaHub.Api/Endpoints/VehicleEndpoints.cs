using TeslaHub.Api.Services;
using TeslaHub.Api.TeslaMate;

namespace TeslaHub.Api.Endpoints;

public static class VehicleEndpoints
{
    public static void MapVehicleEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/vehicle").RequireAuthorization();

        group.MapGet("/cars", async (TeslaMateConnectionFactory tm, CacheService cache) =>
        {
            var cars = await cache.GetOrSetHistoricalAsync("cars", tm.GetCarsAsync);
            return Results.Ok(cars);
        });

        group.MapGet("/{carId:int}/status", async (int carId, TeslaMateConnectionFactory tm, CacheService cache) =>
        {
            var vehicle = await cache.GetOrSetLiveAsync(
                $"vehicle:{carId}",
                () => tm.GetVehicleStatusAsync(carId));
            return vehicle != null ? Results.Ok(vehicle) : Results.NotFound();
        });
    }
}
