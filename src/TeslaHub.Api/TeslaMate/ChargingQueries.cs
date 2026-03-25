using Dapper;
using TeslaHub.Api.Models;

namespace TeslaHub.Api.TeslaMate;

public static class ChargingQueries
{
    public static async Task<IEnumerable<ChargingSessionDto>> GetChargingSessionsAsync(this TeslaMateConnectionFactory db, int carId, int limit = 20, int offset = 0)
    {
        using var conn = db.CreateConnection();
        return await conn.QueryAsync<ChargingSessionDto>("""
            SELECT
                cp.id AS "Id", cp.car_id AS "CarId",
                cp.start_date AS "StartDate", cp.end_date AS "EndDate",
                cp.charge_energy_added AS "ChargeEnergyAdded",
                cp.charge_energy_used AS "ChargeEnergyUsed",
                cp.start_battery_level AS "StartBatteryLevel",
                cp.end_battery_level AS "EndBatteryLevel",
                cp.duration_min AS "DurationMin",
                cp.outside_temp_avg AS "OutsideTempAvg",
                cp.start_rated_range_km AS "StartRatedRangeKm",
                cp.end_rated_range_km AS "EndRatedRangeKm",
                cp.cost AS "Cost",
                a.display_name AS "Address",
                a.latitude AS "Latitude",
                a.longitude AS "Longitude",
                cp.geofence_id AS "GeofenceId",
                g.name AS "GeofenceName",
                ch.fast_charger_present AS "FastChargerPresent",
                ch.fast_charger_type AS "FastChargerType"
            FROM charging_processes cp
            LEFT JOIN addresses a ON cp.address_id = a.id
            LEFT JOIN geofences g ON cp.geofence_id = g.id
            LEFT JOIN LATERAL (
                SELECT fast_charger_present, fast_charger_type
                FROM charges
                WHERE charging_process_id = cp.id
                ORDER BY date
                LIMIT 1
            ) ch ON true
            WHERE cp.car_id = @CarId
            ORDER BY cp.start_date DESC
            LIMIT @Limit OFFSET @Offset
            """, new { CarId = carId, Limit = limit, Offset = offset });
    }

    public static async Task<IEnumerable<ChargePointDto>> GetChargePointsAsync(this TeslaMateConnectionFactory db, int chargingProcessId)
    {
        using var conn = db.CreateConnection();
        return await conn.QueryAsync<ChargePointDto>("""
            SELECT
                date AS "Date",
                battery_level AS "BatteryLevel",
                charge_energy_added AS "ChargeEnergyAdded",
                charger_power AS "ChargerPower",
                rated_battery_range_km AS "RatedBatteryRangeKm"
            FROM charges
            WHERE charging_process_id = @Id
            ORDER BY date
            """, new { Id = chargingProcessId });
    }

    public static async Task<IEnumerable<GeofenceDto>> GetGeofencesAsync(this TeslaMateConnectionFactory db)
    {
        using var conn = db.CreateConnection();
        return await conn.QueryAsync<GeofenceDto>("""
            SELECT id AS "Id", name AS "Name",
                   latitude AS "Latitude", longitude AS "Longitude",
                   radius AS "Radius"
            FROM geofences
            ORDER BY name
            """);
    }
}
