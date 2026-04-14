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
            var vehicleTask = cache.GetOrSetLiveAsync(
                $"vehicle:{carId}",
                () => tm.GetVehicleStatusAsync(carId));
            var computedTask = cache.GetOrSetHistoricalAsync(
                $"vehicleComputed:{carId}",
                () => tm.GetVehicleComputedAsync(carId));

            var vehicle = await vehicleTask;
            if (vehicle == null) return Results.NotFound();
            var computed = await computedTask;

            var live = mqtt.GetLiveData(carId);
            var merged = vehicle with
            {
                CurrentCapacityKwh = computed.CurrentCapacityKwh ?? vehicle.CurrentCapacityKwh,
                MaxCapacityKwh = computed.MaxCapacityKwh ?? vehicle.MaxCapacityKwh,
                KmSinceLastCharge = computed.KmSinceLastCharge,
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
                IsClimateOn = live?.IsClimateOn ?? vehicle.IsClimateOn,
                BatteryLevel = live?.BatteryLevel ?? vehicle.BatteryLevel,
                UsableBatteryLevel = live?.UsableBatteryLevel ?? vehicle.UsableBatteryLevel,
                RatedBatteryRangeKm = live?.RatedBatteryRangeKm ?? vehicle.RatedBatteryRangeKm,
                IdealBatteryRangeKm = live?.IdealBatteryRangeKm ?? vehicle.IdealBatteryRangeKm,
                Latitude = live?.Latitude ?? vehicle.Latitude,
                Longitude = live?.Longitude ?? vehicle.Longitude,
                InsideTemp = live?.InsideTemp ?? vehicle.InsideTemp,
                OutsideTemp = live?.OutsideTemp ?? vehicle.OutsideTemp,
                Odometer = live?.Odometer ?? vehicle.Odometer,
                Speed = live?.Speed ?? vehicle.Speed,
                Power = live?.Power ?? vehicle.Power,
                DriverTempSetting = live?.DriverTempSetting ?? vehicle.DriverTempSetting,
                PassengerTempSetting = live?.PassengerTempSetting ?? vehicle.PassengerTempSetting,
                State = live?.State ?? vehicle.State,
                MqttConnected = mqtt.IsConnected
            };

            return Results.Ok(merged);
        });
    }
}
