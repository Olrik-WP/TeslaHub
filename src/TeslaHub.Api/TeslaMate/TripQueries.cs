using Dapper;
using TeslaHub.Api.Models;

namespace TeslaHub.Api.TeslaMate;

public static class TripQueries
{
    public static async Task<TripSummaryDto> GetTripSummaryAsync(
        this TeslaMateConnectionFactory db, int carId, DateTime from, DateTime to)
    {
        using var conn = db.CreateConnection();
        return await conn.QueryFirstAsync<TripSummaryDto>("""
            WITH drive_data AS (
                SELECT
                    COUNT(*) AS cnt,
                    COALESCE(SUM(distance), 0) AS dist,
                    COALESCE(SUM(duration_min), 0) AS dur,
                    COALESCE(SUM(
                        CASE WHEN distance > 0
                             THEN (start_rated_range_km - end_rated_range_km) * efficiency * 1000 / distance
                             ELSE NULL END * distance / 100
                    ), 0) AS energy,
                    AVG(CASE WHEN distance > 0 AND duration_min > 0
                             THEN distance / (duration_min / 60.0)
                             ELSE NULL END) AS avg_speed,
                    AVG(outside_temp_avg) AS avg_temp
                FROM drives d
                JOIN cars c ON c.id = d.car_id
                WHERE d.car_id = @CarId
                  AND d.start_date >= @From AND d.start_date <= @To
            ),
            charge_data AS (
                SELECT
                    COUNT(*) AS cnt,
                    COALESCE(SUM(duration_min), 0) AS dur,
                    COALESCE(SUM(charge_energy_added), 0) AS added
                FROM charging_processes
                WHERE car_id = @CarId
                  AND start_date >= @From AND start_date <= @To
            )
            SELECT
                d.cnt AS "DriveCount",
                c.cnt AS "ChargeCount",
                d.dist AS "TotalDistanceKm",
                d.dur AS "TotalDriveMin",
                c.dur AS "TotalChargeMin",
                d.energy AS "TotalEnergyUsedKwh",
                c.added AS "TotalEnergyAddedKwh",
                CASE WHEN d.dist > 0 THEN d.energy / d.dist * 100 ELSE NULL END AS "AvgConsumption",
                d.avg_speed AS "AvgSpeedKmh",
                d.avg_temp AS "AvgOutsideTemp"
            FROM drive_data d, charge_data c
            """, new { CarId = carId, From = from, To = to });
    }

    public static async Task<IEnumerable<TripSegmentDto>> GetTripSegmentsAsync(
        this TeslaMateConnectionFactory db, int carId, DateTime from, DateTime to)
    {
        using var conn = db.CreateConnection();
        return await conn.QueryAsync<TripSegmentDto>("""
            SELECT * FROM (
                SELECT
                    'drive' AS "Type",
                    d.id AS "Id",
                    d.start_date AS "StartDate",
                    d.end_date AS "EndDate",
                    d.duration_min AS "DurationMin",
                    d.distance AS "DistanceKm",
                    CASE WHEN d.distance > 0
                         THEN (d.start_rated_range_km - d.end_rated_range_km) * c.efficiency
                         ELSE NULL END AS "EnergyKwh",
                    sa.display_name AS "StartAddress",
                    ea.display_name AS "EndAddress",
                    d.start_km AS "StartBattery",
                    d.end_km AS "EndBattery",
                    CASE WHEN d.duration_min > 0
                         THEN d.distance / (d.duration_min / 60.0)
                         ELSE NULL END AS "AvgSpeedKmh",
                    CASE WHEN d.distance > 0
                         THEN (d.start_rated_range_km - d.end_rated_range_km) * c.efficiency * 1000 / d.distance
                         ELSE NULL END AS "Consumption"
                FROM drives d
                JOIN cars c ON c.id = d.car_id
                LEFT JOIN addresses sa ON d.start_address_id = sa.id
                LEFT JOIN addresses ea ON d.end_address_id = ea.id
                WHERE d.car_id = @CarId
                  AND d.start_date >= @From AND d.start_date <= @To

                UNION ALL

                SELECT
                    'charge' AS "Type",
                    cp.id AS "Id",
                    cp.start_date AS "StartDate",
                    cp.end_date AS "EndDate",
                    cp.duration_min AS "DurationMin",
                    NULL AS "DistanceKm",
                    cp.charge_energy_added AS "EnergyKwh",
                    a.display_name AS "StartAddress",
                    NULL AS "EndAddress",
                    cp.start_battery_level AS "StartBattery",
                    cp.end_battery_level AS "EndBattery",
                    NULL AS "AvgSpeedKmh",
                    NULL AS "Consumption"
                FROM charging_processes cp
                LEFT JOIN addresses a ON cp.address_id = a.id
                WHERE cp.car_id = @CarId
                  AND cp.start_date >= @From AND cp.start_date <= @To
            ) combined
            ORDER BY "StartDate" ASC
            """, new { CarId = carId, From = from, To = to });
    }
}
