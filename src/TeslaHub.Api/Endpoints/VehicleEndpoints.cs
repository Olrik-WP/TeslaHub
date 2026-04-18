using System.Text;
using System.Text.Json;
using TeslaHub.Api.Models;
using TeslaHub.Api.Services;
using TeslaHub.Api.TeslaMate;
using TeslaHub.Api.Utilities;

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
            var computed = await cache.GetOrSetHistoricalAsync(
                $"vehicleComputed:{carId}",
                () => tm.GetVehicleComputedAsync(carId));

            var merged = MergeLiveData(vehicle, computed, mqtt.GetLiveData(carId), mqtt.IsConnected);
            return Results.Ok(merged);
        });

        group.MapGet("/{carId:int}/live-stream", async (int carId, MqttLiveDataService mqtt, HttpContext ctx, CancellationToken ct) =>
        {
            ctx.Response.ContentType = "text/event-stream";
            ctx.Response.Headers.CacheControl = "no-cache";
            ctx.Response.Headers.Connection = "keep-alive";
            ctx.Response.Headers["X-Accel-Buffering"] = "no";

            var current = mqtt.GetLiveData(carId);
            if (current != null)
                await WriteSseEvent(ctx, current, mqtt.IsConnected);

            using var changeSemaphore = new SemaphoreSlim(0);
            MqttLiveData? latest = null;

            void handler(int id, MqttLiveData data)
            {
                if (id != carId) return;
                Volatile.Write(ref latest, data);
                try { changeSemaphore.Release(); } catch { }
            }

            mqtt.OnLiveDataChanged += handler;
            try
            {
                while (!ct.IsCancellationRequested)
                {
                    await changeSemaphore.WaitAsync(ct);
                    var snap = Volatile.Read(ref latest);
                    if (snap != null)
                        await WriteSseEvent(ctx, snap, mqtt.IsConnected);
                }
            }
            catch (OperationCanceledException) { }
            finally
            {
                mqtt.OnLiveDataChanged -= handler;
            }
        });
    }

    private static VehicleDto MergeLiveData(VehicleDto vehicle, (double? CurrentCapacityKwh, double? MaxCapacityKwh, double KmSinceLastCharge) computed, MqttLiveData? live, bool mqttConnected)
    {
        return vehicle with
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
            TpmsPressureFl = live?.TpmsPressureFl ?? vehicle.TpmsPressureFl,
            TpmsPressureFr = live?.TpmsPressureFr ?? vehicle.TpmsPressureFr,
            TpmsPressureRl = live?.TpmsPressureRl ?? vehicle.TpmsPressureRl,
            TpmsPressureRr = live?.TpmsPressureRr ?? vehicle.TpmsPressureRr,
            TpmsSoftWarningFl = live?.TpmsSoftWarningFl ?? vehicle.TpmsSoftWarningFl,
            TpmsSoftWarningFr = live?.TpmsSoftWarningFr ?? vehicle.TpmsSoftWarningFr,
            TpmsSoftWarningRl = live?.TpmsSoftWarningRl ?? vehicle.TpmsSoftWarningRl,
            TpmsSoftWarningRr = live?.TpmsSoftWarningRr ?? vehicle.TpmsSoftWarningRr,
            ClimateKeeperMode = live?.ClimateKeeperMode ?? vehicle.ClimateKeeperMode,
            IsPreconditioning = live?.IsPreconditioning ?? vehicle.IsPreconditioning,
            IsClimateOn = live?.IsClimateOn ?? vehicle.IsClimateOn,
            ChargePortDoorOpen = live?.ChargePortDoorOpen ?? vehicle.ChargePortDoorOpen,
            PluggedIn = live?.PluggedIn ?? vehicle.PluggedIn,
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
            ChargingState = live?.ChargingState ?? vehicle.ChargingState,
            ChargeEnergyAdded = live?.ChargeEnergyAdded ?? vehicle.ChargeEnergyAdded,
            ChargerPower = live?.ChargerPower ?? vehicle.ChargerPower,
            ChargerVoltage = live?.ChargerVoltage ?? vehicle.ChargerVoltage,
            ChargerActualCurrent = live?.ChargerActualCurrent ?? vehicle.ChargerActualCurrent,
            ChargeLimitSoc = live?.ChargeLimitSoc ?? vehicle.ChargeLimitSoc,
            TimeToFullCharge = live?.TimeToFullCharge ?? vehicle.TimeToFullCharge,
            EstBatteryRangeKm = live?.EstBatteryRangeKm ?? vehicle.EstBatteryRangeKm,
            ShiftState = live?.ShiftState ?? vehicle.ShiftState,
            Heading = live?.Heading ?? vehicle.Heading,
            Elevation = live?.Elevation ?? vehicle.Elevation,
            Geofence = live?.Geofence ?? vehicle.Geofence,
            MqttConnected = mqttConnected,
        };
    }

    private static async Task WriteSseEvent(HttpContext ctx, MqttLiveData data, bool mqttConnected)
    {
        var payload = new
        {
            data.Speed,
            data.Power,
            data.Odometer,
            data.BatteryLevel,
            data.UsableBatteryLevel,
            data.RatedBatteryRangeKm,
            data.IdealBatteryRangeKm,
            data.EstBatteryRangeKm,
            data.Latitude,
            data.Longitude,
            data.InsideTemp,
            data.OutsideTemp,
            data.ShiftState,
            data.Heading,
            data.Elevation,
            data.Geofence,
            data.State,
            data.ChargingState,
            data.ChargeEnergyAdded,
            data.ChargerPower,
            data.ChargerVoltage,
            data.ChargerActualCurrent,
            data.ChargeLimitSoc,
            data.TimeToFullCharge,
            data.Locked,
            data.PluggedIn,
            data.ChargePortDoorOpen,
            MqttConnected = mqttConnected,
            data.LastUpdated,
        };

        var json = JsonSerializer.Serialize(payload, JsonOptions.Live);
        var bytes = Encoding.UTF8.GetBytes($"data: {json}\n\n");
        await ctx.Response.Body.WriteAsync(bytes);
        await ctx.Response.Body.FlushAsync();
    }
}
