using Dapper;
using TeslaHub.Api.Models;

namespace TeslaHub.Api.TeslaMate;

public static class ChargingQueries
{
    public static async Task<IEnumerable<ChargingSessionDto>> GetChargingSessionsAsync(this TeslaMateConnectionFactory db, int carId, int limit = 20, int offset = 0, string? chargeType = null)
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
                ch.fast_charger_type AS "FastChargerType",
                ch.charge_type AS "ChargeType",
                CASE WHEN GREATEST(cp.charge_energy_used, cp.charge_energy_added) > 0
                     THEN cp.charge_energy_added / GREATEST(cp.charge_energy_used, cp.charge_energy_added)
                     ELSE NULL END AS "Efficiency",
                CASE WHEN cp.duration_min > 0
                     THEN cp.charge_energy_added * 60.0 / cp.duration_min
                     ELSE NULL END AS "AvgPowerKw",
                CASE WHEN cp.duration_min > 0
                     THEN (cp.end_rated_range_km - cp.start_rated_range_km) * 60.0 / cp.duration_min
                     ELSE NULL END AS "ChargeRateKmPerHour",
                cp.end_rated_range_km - cp.start_rated_range_km AS "RangeAddedKm",
                CASE WHEN GREATEST(cp.charge_energy_used, cp.charge_energy_added) > 0
                     THEN cp.cost / GREATEST(cp.charge_energy_used, cp.charge_energy_added)
                     ELSE NULL END AS "CostPerKwh"
            FROM charging_processes cp
            LEFT JOIN addresses a ON cp.address_id = a.id
            LEFT JOIN geofences g ON cp.geofence_id = g.id
            LEFT JOIN LATERAL (
                SELECT fast_charger_present, fast_charger_type,
                       CASE WHEN NULLIF(mode() WITHIN GROUP (ORDER BY charger_phases), 0) IS NULL
                            THEN 'DC' ELSE 'AC' END AS charge_type
                FROM charges
                WHERE charging_process_id = cp.id
                GROUP BY fast_charger_present, fast_charger_type
            ) ch ON true
            WHERE cp.car_id = @CarId
              AND (@ChargeType IS NULL OR ch.charge_type = @ChargeType)
            ORDER BY cp.start_date DESC
            LIMIT @Limit OFFSET @Offset
            """, new { CarId = carId, Limit = limit, Offset = offset, ChargeType = chargeType });
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

    public static async Task<ChargingStatsDto?> GetChargingStatsAsync(this TeslaMateConnectionFactory db, int carId)
    {
        using var conn = db.CreateConnection();
        return await conn.QueryFirstOrDefaultAsync<ChargingStatsDto>("""
            SELECT
                COUNT(*) AS "ChargeCount",
                COALESCE(SUM(charge_energy_added), 0) AS "TotalEnergyAdded",
                COALESCE(SUM(GREATEST(charge_energy_added, charge_energy_used)), 0) AS "TotalEnergyUsed",
                CASE WHEN SUM(GREATEST(charge_energy_added, charge_energy_used)) > 0
                     THEN SUM(charge_energy_added) / SUM(GREATEST(charge_energy_added, charge_energy_used))
                     ELSE 0 END AS "ChargingEfficiency"
            FROM charging_processes
            WHERE car_id = @CarId AND charge_energy_added > 0.01
            """, new { CarId = carId });
    }

    public static async Task<ChargingSummaryDto?> GetChargingSummaryAsync(this TeslaMateConnectionFactory db, int carId, int? days = null)
    {
        using var conn = db.CreateConnection();
        return await conn.QueryFirstOrDefaultAsync<ChargingSummaryDto>("""
            SELECT
                COUNT(*) AS "ChargeCount",
                COALESCE(SUM(charge_energy_added), 0) AS "TotalEnergyAdded",
                COALESCE(SUM(GREATEST(charge_energy_added, charge_energy_used)), 0) AS "TotalEnergyUsed",
                COALESCE(SUM(cost), 0) AS "TotalCost",
                COALESCE(AVG(duration_min), 0) AS "AvgDurationMin",
                CASE WHEN SUM(GREATEST(charge_energy_added, charge_energy_used)) > 0
                     THEN SUM(charge_energy_added) / SUM(GREATEST(charge_energy_added, charge_energy_used))
                     ELSE 0 END AS "AvgEfficiency"
            FROM charging_processes
            WHERE car_id = @CarId
              AND charge_energy_added > 0.01
              AND (@Days IS NULL OR start_date >= NOW() - INTERVAL '1 day' * @Days)
            """, new { CarId = carId, Days = days });
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

    public static async Task<CostSummaryDto> GetTeslaMateCostSummaryAsync(
        this TeslaMateConnectionFactory db, int carId, int year, int month)
    {
        using var conn = db.CreateConnection();
        var monthStart = new DateTime(year, month, 1, 0, 0, 0, DateTimeKind.Utc);
        var monthEnd = monthStart.AddMonths(1);

        var row = await conn.QueryFirstOrDefaultAsync<(
            decimal TotalCost,
            decimal TotalKwh,
            int SessionCount,
            int FreeCount
        )>("""
            SELECT
                COALESCE(SUM(CASE WHEN cost > 0 THEN cost ELSE 0 END), 0),
                COALESCE(SUM(charge_energy_added), 0),
                COUNT(*),
                COUNT(*) FILTER (WHERE cost IS NULL OR cost <= 0)
            FROM charging_processes
            WHERE car_id = @CarId
              AND charge_energy_added > 0.01
              AND start_date >= @Start AND start_date < @End
            """, new { CarId = carId, Start = monthStart, End = monthEnd });

        var locationRows = await conn.QueryAsync<(string Name, decimal Cost)>("""
            SELECT
                COALESCE(g.name, SPLIT_PART(a.display_name, ',', 1), 'Other') AS "Name",
                SUM(cp.cost) AS "Cost"
            FROM charging_processes cp
            LEFT JOIN geofences g ON cp.geofence_id = g.id
            LEFT JOIN addresses a ON cp.address_id = a.id
            WHERE cp.car_id = @CarId
              AND cp.charge_energy_added > 0.01
              AND cp.cost > 0
              AND cp.start_date >= @Start AND cp.start_date < @End
            GROUP BY COALESCE(g.name, SPLIT_PART(a.display_name, ',', 1), 'Other')
            ORDER BY "Cost" DESC
            """, new { CarId = carId, Start = monthStart, End = monthEnd });

        return new CostSummaryDto
        {
            Period = $"{year}-{month:D2}",
            TotalCost = row.TotalCost,
            TotalKwh = row.TotalKwh,
            AvgPricePerKwh = row.TotalKwh > 0 ? Math.Round(row.TotalCost / row.TotalKwh, 4) : 0,
            SessionCount = row.SessionCount,
            FreeSessionCount = row.FreeCount,
            CostByLocation = locationRows.ToDictionary(r => r.Name, r => r.Cost)
        };
    }

    public static async Task<IEnumerable<MonthlyTrendDto>> GetTeslaMateMonthlyTrendAsync(
        this TeslaMateConnectionFactory db, int carId)
    {
        using var conn = db.CreateConnection();
        return await conn.QueryAsync<MonthlyTrendDto>("""
            SELECT
                TO_CHAR(start_date, 'YYYY-MM') AS "Month",
                COALESCE(SUM(cost), 0) AS "Cost"
            FROM charging_processes
            WHERE car_id = @CarId
              AND charge_energy_added > 0.01
              AND cost > 0
            GROUP BY TO_CHAR(start_date, 'YYYY-MM')
            ORDER BY "Month" DESC
            LIMIT 12
            """, new { CarId = carId });
    }
}
