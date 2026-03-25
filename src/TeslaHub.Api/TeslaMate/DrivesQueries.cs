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
