using Dapper;
using TeslaHub.Api.Models;

namespace TeslaHub.Api.TeslaMate;

public static class ChargingQueries
{
    public static async Task<IEnumerable<ChargingSessionDto>> GetChargingSessionsAsync(this TeslaMateConnectionFactory db, int carId, int limit = 20, int offset = 0, string? chargeType = null)
    {
        using var conn = db.CreateConnection();
        return await conn.QueryAsync<ChargingSessionDto>("""
            WITH data AS (
                SELECT
                    cp.id,
                    cp.car_id,
                    cp.start_date,
                    cp.end_date,
                    cp.charge_energy_added,
                    cp.charge_energy_used,
                    cp.start_battery_level,
                    cp.end_battery_level,
                    cp.duration_min,
                    cp.outside_temp_avg,
                    cp.start_rated_range_km,
                    cp.end_rated_range_km,
                    cp.cost,
                    a.display_name AS address,
                    a.latitude,
                    a.longitude,
                    cp.geofence_id,
                    g.name AS geofence_name,
                    ch.fast_charger_present,
                    ch.fast_charger_type,
                    ch.charge_type,
                    COALESCE(p.odometer, p2.odometer) AS odometer,
                    COALESCE(p.odometer, p2.odometer)
                        - LAG(COALESCE(p.odometer, p2.odometer)) OVER (ORDER BY cp.start_date) AS distance_since_last_charge
                FROM charging_processes cp
                LEFT JOIN positions p ON p.id = cp.position_id
                LEFT JOIN LATERAL (
                    SELECT odometer FROM positions
                    WHERE car_id = cp.car_id AND date <= cp.start_date AND odometer IS NOT NULL
                    ORDER BY date DESC LIMIT 1
                ) p2 ON p.odometer IS NULL
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
            )
            SELECT
                id AS "Id", car_id AS "CarId",
                start_date AS "StartDate", end_date AS "EndDate",
                charge_energy_added AS "ChargeEnergyAdded",
                charge_energy_used AS "ChargeEnergyUsed",
                start_battery_level AS "StartBatteryLevel",
                end_battery_level AS "EndBatteryLevel",
                duration_min AS "DurationMin",
                outside_temp_avg AS "OutsideTempAvg",
                start_rated_range_km AS "StartRatedRangeKm",
                end_rated_range_km AS "EndRatedRangeKm",
                cost AS "Cost",
                address AS "Address",
                latitude AS "Latitude",
                longitude AS "Longitude",
                geofence_id AS "GeofenceId",
                geofence_name AS "GeofenceName",
                fast_charger_present AS "FastChargerPresent",
                fast_charger_type AS "FastChargerType",
                charge_type AS "ChargeType",
                CASE WHEN GREATEST(charge_energy_used, charge_energy_added) > 0
                     THEN charge_energy_added / GREATEST(charge_energy_used, charge_energy_added)
                     ELSE NULL END AS "Efficiency",
                CASE WHEN duration_min > 0
                     THEN charge_energy_added * 60.0 / duration_min
                     ELSE NULL END AS "AvgPowerKw",
                CASE WHEN duration_min > 0
                     THEN (end_rated_range_km - start_rated_range_km) * 60.0 / duration_min
                     ELSE NULL END AS "ChargeRateKmPerHour",
                end_rated_range_km - start_rated_range_km AS "RangeAddedKm",
                CASE WHEN GREATEST(charge_energy_used, charge_energy_added) > 0
                     THEN cost / GREATEST(charge_energy_used, charge_energy_added)
                     ELSE NULL END AS "CostPerKwh",
                odometer AS "Odometer",
                distance_since_last_charge AS "DistanceSinceLastCharge"
            FROM data
            ORDER BY start_date DESC
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
        this TeslaMateConnectionFactory db, int carId, DateTime? start, DateTime? end, string label, double totalDistanceKm)
    {
        using var conn = db.CreateConnection();

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
              AND (@Start IS NULL OR start_date >= @Start)
              AND (@End IS NULL OR start_date < @End)
            """, new { CarId = carId, Start = start, End = end });

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
              AND (@Start IS NULL OR cp.start_date >= @Start)
              AND (@End IS NULL OR cp.start_date < @End)
            GROUP BY COALESCE(g.name, SPLIT_PART(a.display_name, ',', 1), 'Other')
            ORDER BY "Cost" DESC
            """, new { CarId = carId, Start = start, End = end });

        return new CostSummaryDto
        {
            Period = label,
            TotalCost = row.TotalCost,
            TotalKwh = row.TotalKwh,
            AvgPricePerKwh = row.TotalKwh > 0 ? Math.Round(row.TotalCost / row.TotalKwh, 4) : 0,
            CostPerKm = totalDistanceKm > 0 ? Math.Round(row.TotalCost / (decimal)totalDistanceKm, 4) : 0,
            TotalDistanceKm = (decimal)totalDistanceKm,
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

    public static async Task<IEnumerable<ChargingCurvePointDto>> GetChargingCurvePointsAsync(
        this TeslaMateConnectionFactory db, int carId)
    {
        using var conn = db.CreateConnection();
        return await conn.QueryAsync<ChargingCurvePointDto>("""
            SELECT
                c.battery_level AS "SoC",
                ROUND(AVG(c.charger_power)::numeric, 0) AS "Power",
                c.charging_process_id AS "ChargingProcessId",
                COALESCE(g.name, SPLIT_PART(a.display_name, ',', 1))
                    || ' ' || TO_CHAR(c.date, 'YYYY-MM-DD') AS "Label"
            FROM charges c
            JOIN charging_processes p ON p.id = c.charging_process_id
            LEFT JOIN addresses a ON a.id = p.address_id
            LEFT JOIN geofences g ON g.id = p.geofence_id
            WHERE p.car_id = @CarId
              AND c.charger_power > 0
              AND c.fast_charger_present
            GROUP BY c.battery_level, c.charging_process_id,
                     a.display_name, g.name,
                     TO_CHAR(c.date, 'YYYY-MM-DD')
            ORDER BY c.battery_level
            """, new { CarId = carId });
    }

    public static async Task<IEnumerable<ChargingCurveMedianDto>> GetChargingCurveMedianAsync(
        this TeslaMateConnectionFactory db, int carId)
    {
        using var conn = db.CreateConnection();
        return await conn.QueryAsync<ChargingCurveMedianDto>("""
            SELECT
                c.battery_level AS "SoC",
                ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY c.charger_power)::numeric, 0) AS "Power"
            FROM charges c
            JOIN charging_processes p ON p.id = c.charging_process_id
            WHERE p.car_id = @CarId
              AND c.charger_power > 0
              AND c.fast_charger_present
            GROUP BY c.battery_level
            ORDER BY c.battery_level
            """, new { CarId = carId });
    }

    public static async Task<IEnumerable<ChargingSessionDto>> GetChargingSessionsForLocationAsync(
        this TeslaMateConnectionFactory db, int carId, double lat, double lng, int radiusMeters)
    {
        using var conn = db.CreateConnection();
        return await conn.QueryAsync<ChargingSessionDto>("""
            SELECT
                cp.id AS "Id",
                cp.car_id AS "CarId",
                cp.start_date AS "StartDate",
                cp.end_date AS "EndDate",
                cp.charge_energy_added AS "ChargeEnergyAdded",
                cp.charge_energy_used AS "ChargeEnergyUsed",
                a.latitude AS "Latitude",
                a.longitude AS "Longitude"
            FROM charging_processes cp
            LEFT JOIN addresses a ON cp.address_id = a.id
            WHERE cp.car_id = @CarId
              AND cp.charge_energy_added > 0.01
              AND a.latitude IS NOT NULL
              AND a.longitude IS NOT NULL
              AND (
                  6371000.0 * 2 * ASIN(SQRT(
                      POWER(SIN(RADIANS(a.latitude - @Lat) / 2), 2)
                      + COS(RADIANS(@Lat)) * COS(RADIANS(a.latitude))
                      * POWER(SIN(RADIANS(a.longitude - @Lng) / 2), 2)
                  ))
              ) <= @Radius
            ORDER BY cp.start_date
            """, new { CarId = carId, Lat = lat, Lng = lng, Radius = radiusMeters });
    }

    public static async Task<IEnumerable<int>> GetCarIdsAsync(this TeslaMateConnectionFactory db)
    {
        using var conn = db.CreateConnection();
        return await conn.QueryAsync<int>("SELECT id FROM cars ORDER BY id");
    }
}
