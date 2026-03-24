using Dapper;
using TeslaHub.Api.Models;

namespace TeslaHub.Api.TeslaMate;

public static class PositionsQueries
{
    public static async Task<IEnumerable<PositionDto>> GetRecentPositionsAsync(this TeslaMateConnectionFactory db, int carId, int hours = 24)
    {
        using var conn = db.CreateConnection();
        return await conn.QueryAsync<PositionDto>("""
            SELECT
                id AS "Id", date AS "Date",
                latitude AS "Latitude", longitude AS "Longitude",
                speed AS "Speed", power AS "Power",
                battery_level AS "BatteryLevel",
                elevation AS "Elevation"
            FROM positions
            WHERE car_id = @CarId
              AND date >= NOW() - @Hours * INTERVAL '1 hour'
              AND drive_id IS NOT NULL
            ORDER BY date
            """, new { CarId = carId, Hours = hours });
    }

    public static async Task<StatsDto> GetStatsAsync(this TeslaMateConnectionFactory db, int carId, DateTime from, DateTime to)
    {
        using var conn = db.CreateConnection();

        var drives = await conn.QueryFirstOrDefaultAsync<(double Distance, int Count, double AvgConsumption)>("""
            SELECT
                COALESCE(SUM(distance), 0),
                COUNT(*),
                CASE WHEN SUM(distance) > 0
                    THEN (SUM(start_rated_range_km - end_rated_range_km) * MAX(c.efficiency))
                         / (SUM(distance) / 1000.0) * 100.0
                    ELSE 0
                END
            FROM drives d
            JOIN cars c ON d.car_id = c.id
            WHERE d.car_id = @CarId
              AND d.start_date >= @From AND d.start_date < @To
            """, new { CarId = carId, From = from, To = to });

        var charges = await conn.QueryFirstOrDefaultAsync<(double Energy, int Count)>("""
            SELECT
                COALESCE(SUM(charge_energy_added), 0),
                COUNT(*)
            FROM charging_processes
            WHERE car_id = @CarId
              AND start_date >= @From AND start_date < @To
            """, new { CarId = carId, From = from, To = to });

        return new StatsDto
        {
            Period = $"{from:yyyy-MM-dd} - {to:yyyy-MM-dd}",
            TotalDistanceKm = Math.Round(drives.Distance / 1000.0, 1),
            TotalEnergyAddedKWh = Math.Round(charges.Energy, 1),
            DriveCount = drives.Count,
            ChargeCount = charges.Count,
            AvgConsumptionKWhPer100Km = Math.Round(drives.AvgConsumption, 1)
        };
    }
}
