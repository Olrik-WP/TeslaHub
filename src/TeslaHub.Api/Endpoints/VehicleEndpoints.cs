using TeslaHub.Api.Models;
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

        group.MapGet("/{carId:int}/status", async (int carId, TeslaMateConnectionFactory tm, CacheService cache, MqttLiveDataService mqtt) =>
        {
            var vehicle = await cache.GetOrSetLiveAsync(
                $"vehicle:{carId}",
                () => tm.GetVehicleStatusAsync(carId));

            if (vehicle == null) return Results.NotFound();

            var live = mqtt.GetLiveData(carId);
            var merged = vehicle with
            {
                IsLocked = live?.Locked ?? vehicle.IsLocked,
                DoorsOpen = live?.DoorsOpen ?? vehicle.DoorsOpen,
                DriverFrontDoorOpen = live?.DriverFrontDoorOpen ?? vehicle.DriverFrontDoorOpen,
                DriverRearDoorOpen = live?.DriverRearDoorOpen ?? vehicle.DriverRearDoorOpen,
                PassengerFrontDoorOpen = live?.PassengerFrontDoorOpen ?? vehicle.PassengerFrontDoorOpen,
                PassengerRearDoorOpen = live?.PassengerRearDoorOpen ?? vehicle.PassengerRearDoorOpen,
                TrunkOpen = live?.TrunkOpen ?? vehicle.TrunkOpen,
                FrunkOpen = live?.FrunkOpen ?? vehicle.FrunkOpen,
                WindowsOpen = live?.WindowsOpen ?? vehicle.WindowsOpen,
                SentryMode = live?.SentryMode ?? vehicle.SentryMode,
                IsUserPresent = live?.IsUserPresent ?? vehicle.IsUserPresent,
                TpmsSoftWarningFl = live?.TpmsSoftWarningFl ?? vehicle.TpmsSoftWarningFl,
                TpmsSoftWarningFr = live?.TpmsSoftWarningFr ?? vehicle.TpmsSoftWarningFr,
                TpmsSoftWarningRl = live?.TpmsSoftWarningRl ?? vehicle.TpmsSoftWarningRl,
                TpmsSoftWarningRr = live?.TpmsSoftWarningRr ?? vehicle.TpmsSoftWarningRr,
                ClimateKeeperMode = live?.ClimateKeeperMode ?? vehicle.ClimateKeeperMode,
                IsPreconditioning = live?.IsPreconditioning ?? vehicle.IsPreconditioning,
                MqttConnected = mqtt.IsConnected
            };

            return Results.Ok(merged);
        });
    }
}
