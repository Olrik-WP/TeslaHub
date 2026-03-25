using Dapper;
using TeslaHub.Api.Models;

namespace TeslaHub.Api.TeslaMate;

public static class DrivesQueries
{
    public static async Task<IEnumerable<DriveDto>> GetDrivesAsync(this TeslaMateConnectionFactory db, int carId, int limit = 20, int offset = 0)
    {
        using var conn = db.CreateConnection();
        return await conn.QueryAsync<DriveDto>("""
            SELECT
                d.id AS "Id", d.car_id AS "CarId",
                d.start_date AS "StartDate", d.end_date AS "EndDate",
                d.start_km AS "StartKm", d.end_km AS "EndKm",
                d.distance AS "Distance", d.duration_min AS "DurationMin",
                d.speed_max AS "SpeedMax", d.power_max AS "PowerMax", d.power_min AS "PowerMin",
                d.start_rated_range_km AS "StartRatedRangeKm",
                d.end_rated_range_km AS "EndRatedRangeKm",
                d.outside_temp_avg AS "OutsideTempAvg",
                d.inside_temp_avg AS "InsideTempAvg",
                d.ascent AS "Ascent", d.descent AS "Descent",
                sa.display_name AS "StartAddress",
                ea.display_name AS "EndAddress",
                CASE WHEN d.distance > 0
                    THEN (d.start_rated_range_km - d.end_rated_range_km) * c.efficiency / d.distance * 100.0
                    ELSE NULL
                END AS "ConsumptionKWhPer100Km"
            FROM drives d
            JOIN cars c ON d.car_id = c.id
            LEFT JOIN addresses sa ON d.start_address_id = sa.id
            LEFT JOIN addresses ea ON d.end_address_id = ea.id
            WHERE d.car_id = @CarId
            ORDER BY d.start_date DESC
            LIMIT @Limit OFFSET @Offset
            """, new { CarId = carId, Limit = limit, Offset = offset });
    }

    public static async Task<DriveStatsDto?> GetDriveStatsAsync(this TeslaMateConnectionFactory db, int carId)
    {
        using var conn = db.CreateConnection();
        return await conn.QueryFirstOrDefaultAsync<DriveStatsDto>("""
            SELECT
                COUNT(*) AS "DriveCount",
                MAX(d.speed_max) AS "MaxSpeedKmh",
                percentile_cont(0.5) WITHIN GROUP (ORDER BY d.distance) AS "MedianDistanceKm",
                COALESCE(SUM(d.distance), 0) AS "TotalDistanceKm",
                COALESCE(SUM((d.start_rated_range_km - d.end_rated_range_km) * c.efficiency), 0) AS "TotalNetEnergyKwh",
                GREATEST(EXTRACT(epoch FROM (NOW() - MIN(d.start_date))) / 86400.0, 1) AS "TotalDays",
                COALESCE(MAX(d.end_km) - MIN(d.start_km), 0) AS "TotalMileageKm"
            FROM drives d
            INNER JOIN cars c ON d.car_id = c.id
            WHERE d.car_id = @CarId AND d.end_date IS NOT NULL
            """, new { CarId = carId });
    }

    public static async Task<double> GetTotalDistanceAsync(this TeslaMateConnectionFactory db, int carId, DateTime? from, DateTime? to)
    {
        using var conn = db.CreateConnection();
        return await conn.ExecuteScalarAsync<double>("""
            SELECT COALESCE(SUM(distance), 0)
            FROM drives
            WHERE car_id = @CarId
              AND end_date IS NOT NULL
              AND (@From IS NULL OR start_date >= @From)
              AND (@To IS NULL OR start_date < @To)
            """, new { CarId = carId, From = from, To = to });
    }

    public static async Task<IEnumerable<PositionDto>> GetDrivePositionsAsync(this TeslaMateConnectionFactory db, int driveId)
    {
        using var conn = db.CreateConnection();
        return await conn.QueryAsync<PositionDto>("""
            SELECT
                id AS "Id", date AS "Date",
                latitude AS "Latitude", longitude AS "Longitude",
                speed AS "Speed", power AS "Power",
                battery_level AS "BatteryLevel",
                elevation AS "Elevation", odometer AS "Odometer",
                rated_battery_range_km AS "RatedBatteryRangeKm"
            FROM positions
            WHERE drive_id = @DriveId
            ORDER BY date
            """, new { DriveId = driveId });
    }
}
