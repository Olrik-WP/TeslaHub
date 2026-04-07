using Dapper;
using TeslaHub.Api.Models;

namespace TeslaHub.Api.TeslaMate;

public static class StatisticsQueries
{
    public static async Task<IEnumerable<PeriodStatsDto>> GetPeriodicStatsAsync(
        this TeslaMateConnectionFactory db, int carId, string period)
    {
        using var conn = db.CreateConnection();

        var validPeriod = period switch
        {
            "day" => "day",
            "week" => "week",
            "year" => "year",
            _ => "month"
        };

        var labelExpr = validPeriod switch
        {
            "year" => "to_char(COALESCE(dd.date, cd.date), 'YYYY')",
            "week" => "'W' || to_char(COALESCE(dd.date, cd.date), 'IW') || ' ' || to_char(COALESCE(dd.date, cd.date), 'IYYY')",
            "day" => "to_char(COALESCE(dd.date, cd.date), 'YYYY-MM-DD')",
            _ => "to_char(COALESCE(dd.date, cd.date), 'YYYY-MM')"
        };

        return await conn.QueryAsync<PeriodStatsDto>($"""
            WITH drive_data AS (
                SELECT
                    date_trunc('{validPeriod}', start_date) AS date,
                    SUM(distance) AS distance,
                    COUNT(*) AS drive_count,
                    SUM(duration_min) AS duration_min,
                    AVG(outside_temp_avg) AS avg_temp,
                    CASE WHEN SUM(GREATEST(start_rated_range_km - end_rated_range_km, 0)) > 0
                         THEN SUM(GREATEST(start_rated_range_km - end_rated_range_km, 0) * c.efficiency) / NULLIF(SUM(distance), 0) * 100
                         ELSE NULL END AS consumption_net
                FROM drives d
                JOIN cars c ON c.id = d.car_id
                WHERE d.car_id = @CarId AND d.end_date IS NOT NULL
                GROUP BY date, c.efficiency
            ),
            charge_data AS (
                SELECT
                    date_trunc('{validPeriod}', start_date) AS date,
                    SUM(charge_energy_added) AS energy_added,
                    COUNT(*) AS charge_count
                FROM charging_processes
                WHERE car_id = @CarId AND (charge_energy_added IS NULL OR charge_energy_added > 0.1)
                GROUP BY 1
            )
            SELECT
                {labelExpr} AS "Label",
                dd.distance AS "DistanceKm",
                COALESCE(dd.drive_count, 0)::int AS "DriveCount",
                dd.duration_min AS "DriveDurationMin",
                cd.energy_added AS "EnergyAddedKwh",
                COALESCE(cd.charge_count, 0)::int AS "ChargeCount",
                dd.avg_temp AS "AvgTempC",
                dd.consumption_net AS "ConsumptionNetKwhPer100Km"
            FROM drive_data dd
            FULL OUTER JOIN charge_data cd ON dd.date = cd.date
            ORDER BY COALESCE(dd.date, cd.date) DESC
            LIMIT 60
            """, new { CarId = carId });
    }
}
