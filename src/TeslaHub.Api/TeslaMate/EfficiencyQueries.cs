using Dapper;
using TeslaHub.Api.Models;

namespace TeslaHub.Api.TeslaMate;

public static class EfficiencyQueries
{
    public static async Task<EfficiencySummaryDto> GetEfficiencySummaryAsync(
        this TeslaMateConnectionFactory db, int carId)
    {
        using var conn = db.CreateConnection();

        var net = await conn.QueryFirstOrDefaultAsync<double?>("""
            SELECT
                SUM((start_rated_range_km - end_rated_range_km) * c.efficiency)
                / NULLIF(SUM(distance), 0) * 100.0
            FROM drives d
            INNER JOIN cars c ON c.id = d.car_id
            WHERE d.car_id = @CarId
              AND distance IS NOT NULL AND distance > 0
              AND start_rated_range_km - end_rated_range_km >= 0.1
            """, new { CarId = carId });

        var gross = await conn.QueryFirstOrDefaultAsync<double?>("""
            WITH d1 AS (
                SELECT
                    lag(end_rated_range_km) OVER (ORDER BY start_date) - start_rated_range_km AS range_loss,
                    p.odometer - lag(p.odometer) OVER (ORDER BY start_date) AS distance
                FROM charging_processes cp
                LEFT JOIN positions p ON p.id = cp.position_id
                WHERE cp.end_date IS NOT NULL AND cp.car_id = @CarId
                ORDER BY start_date
            )
            SELECT
                SUM(range_loss) * MAX(c.efficiency) / NULLIF(SUM(d1.distance), 0) * 100.0
            FROM d1
            CROSS JOIN (SELECT efficiency FROM cars WHERE id = @CarId) c
            WHERE d1.distance >= 0 AND d1.range_loss >= 0
            """, new { CarId = carId });

        var totalDist = await conn.ExecuteScalarAsync<double?>("""
            SELECT SUM(distance) FROM drives WHERE car_id = @CarId AND distance IS NOT NULL
            """, new { CarId = carId });

        var currentEff = await conn.ExecuteScalarAsync<double?>("""
            SELECT efficiency * 1000 FROM cars WHERE id = @CarId
            """, new { CarId = carId });

        var derived = await conn.QueryAsync<DerivedEfficiencyDto>("""
            SELECT
                ROUND((charge_energy_added / NULLIF(end_rated_range_km - start_rated_range_km, 0))::numeric * 100, 1) AS "EfficiencyKwhPer100Km",
                COUNT(*) AS "Count"
            FROM charging_processes
            WHERE car_id = @CarId
              AND duration_min > 10 AND end_battery_level <= 95
              AND start_rated_range_km IS NOT NULL AND end_rated_range_km IS NOT NULL
              AND charge_energy_added > 0
            GROUP BY 1 ORDER BY "Count" DESC LIMIT 5
            """, new { CarId = carId });

        var tempEff = await conn.QueryAsync<TempEfficiencyDto>("""
            SELECT
                ROUND(outside_temp_avg / 5.0) * 5 AS "TemperatureC",
                SUM((start_rated_range_km - end_rated_range_km) * c.efficiency) / NULLIF(SUM(distance), 0) * 100.0 AS "ConsumptionKwhPer100Km",
                SUM(distance) AS "TotalDistanceKm"
            FROM drives d
            INNER JOIN cars c ON c.id = d.car_id
            WHERE d.car_id = @CarId
              AND distance IS NOT NULL AND distance > 1
              AND start_rated_range_km - end_rated_range_km > 0.1
              AND outside_temp_avg IS NOT NULL
            GROUP BY 1
            HAVING SUM(distance) > 5
            ORDER BY 1
            """, new { CarId = carId });

        return new EfficiencySummaryDto
        {
            AvgConsumptionNetKwhPer100Km = net,
            AvgConsumptionGrossKwhPer100Km = gross,
            TotalDistanceKm = totalDist,
            CurrentEfficiencyWhPerKm = currentEff,
            DerivedEfficiencies = derived.ToList(),
            TemperatureEfficiency = tempEff.ToList()
        };
    }
}
