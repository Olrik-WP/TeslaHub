using Dapper;
using TeslaHub.Api.Models;

namespace TeslaHub.Api.TeslaMate;

public static class VehicleQueries
{
    public static async Task<IEnumerable<CarListItemDto>> GetCarsAsync(this TeslaMateConnectionFactory db)
    {
        using var conn = db.CreateConnection();
        return await conn.QueryAsync<CarListItemDto>("""
            SELECT id AS "Id", name AS "Name", model AS "Model",
                   marketing_name AS "MarketingName", vin AS "Vin"
            FROM cars
            ORDER BY display_priority, id
            """);
    }

    public static async Task<VehicleDto?> GetVehicleStatusAsync(this TeslaMateConnectionFactory db, int carId)
    {
        using var conn = db.CreateConnection();
        return await conn.QueryFirstOrDefaultAsync<VehicleDto>("""
            SELECT
                c.id AS "CarId", c.name AS "Name", c.model AS "Model",
                c.marketing_name AS "MarketingName", c.trim_badging AS "TrimBadging",
                c.exterior_color AS "ExteriorColor", c.wheel_type AS "WheelType",
                c.vin AS "Vin", c.efficiency AS "Efficiency",
                p.battery_level AS "BatteryLevel",
                p.usable_battery_level AS "UsableBatteryLevel",
                p.rated_battery_range_km AS "RatedBatteryRangeKm",
                p.ideal_battery_range_km AS "IdealBatteryRangeKm",
                p.odometer AS "Odometer",
                p.latitude AS "Latitude", p.longitude AS "Longitude",
                p.inside_temp AS "InsideTemp", p.outside_temp AS "OutsideTemp",
                p.speed AS "Speed", p.power AS "Power",
                p.date AS "PositionDate",
                s.state AS "State",
                u.version AS "FirmwareVersion",
                deg.max_full_range_km AS "MaxFullRangeKm"
            FROM cars c
            LEFT JOIN LATERAL (
                SELECT * FROM positions
                WHERE car_id = c.id
                ORDER BY date DESC
                LIMIT 1
            ) p ON true
            LEFT JOIN LATERAL (
                SELECT state FROM states
                WHERE car_id = c.id
                ORDER BY start_date DESC
                LIMIT 1
            ) s ON true
            LEFT JOIN LATERAL (
                SELECT version FROM updates
                WHERE car_id = c.id
                ORDER BY start_date DESC
                LIMIT 1
            ) u ON true
            LEFT JOIN LATERAL (
                SELECT MAX(rated_battery_range_km * 100.0 / NULLIF(battery_level, 0)) AS max_full_range_km
                FROM positions
                WHERE car_id = c.id AND battery_level >= 50
            ) deg ON true
            WHERE c.id = @CarId
            """, new { CarId = carId });
    }
}
