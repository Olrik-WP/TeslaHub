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
                cap.current_capacity_kwh AS "CurrentCapacityKwh",
                maxcap.max_capacity_kwh AS "MaxCapacityKwh"
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
                SELECT COALESCE(
                    (
                        SELECT ROUND((charge_energy_added / NULLIF(end_rated_range_km - start_rated_range_km, 0))::numeric, 3) * 100
                        FROM charging_processes
                        WHERE car_id = c.id
                            AND duration_min > 10
                            AND end_battery_level <= 95
                            AND start_rated_range_km IS NOT NULL
                            AND end_rated_range_km IS NOT NULL
                            AND charge_energy_added > 0
                        GROUP BY ROUND((charge_energy_added / NULLIF(end_rated_range_km - start_rated_range_km, 0))::numeric, 3) * 100
                        ORDER BY COUNT(*) DESC
                        LIMIT 1
                    ),
                    c.efficiency * 100
                ) AS rated_efficiency
            ) eff ON true
            LEFT JOIN LATERAL (
                SELECT AVG(sub.cap) AS current_capacity_kwh
                FROM (
                    SELECT ch.rated_battery_range_km * eff.rated_efficiency / ch.usable_battery_level AS cap
                    FROM charging_processes cp2
                    INNER JOIN charges ch ON ch.charging_process_id = cp2.id
                    WHERE cp2.car_id = c.id
                        AND cp2.end_date IS NOT NULL
                        AND cp2.charge_energy_added >= eff.rated_efficiency
                        AND ch.usable_battery_level > 0
                    ORDER BY cp2.end_date DESC, ch.date DESC
                    LIMIT 100
                ) sub
            ) cap ON true
            LEFT JOIN LATERAL (
                SELECT MAX(ch.rated_battery_range_km * eff.rated_efficiency / ch.usable_battery_level) AS max_capacity_kwh
                FROM charging_processes cp2
                INNER JOIN (
                    SELECT charging_process_id, MAX(date) AS date
                    FROM charges WHERE usable_battery_level > 0
                    GROUP BY charging_process_id
                ) gc ON cp2.id = gc.charging_process_id
                INNER JOIN charges ch ON ch.charging_process_id = cp2.id AND ch.date = gc.date
                WHERE cp2.car_id = c.id
                    AND cp2.end_date IS NOT NULL
                    AND cp2.charge_energy_added >= eff.rated_efficiency
            ) maxcap ON true
            WHERE c.id = @CarId
            """, new { CarId = carId });
    }
}
