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
                COALESCE(p.rated_battery_range_km, fallback.rated_battery_range_km) AS "RatedBatteryRangeKm",
                COALESCE(p.ideal_battery_range_km, fallback.ideal_battery_range_km) AS "IdealBatteryRangeKm",
                p.odometer AS "Odometer",
                p.latitude AS "Latitude", p.longitude AS "Longitude",
                COALESCE(p.inside_temp, fallback.inside_temp) AS "InsideTemp",
                COALESCE(p.outside_temp, fallback.outside_temp) AS "OutsideTemp",
                p.speed AS "Speed", p.power AS "Power",
                p.date AS "PositionDate",

                COALESCE(p.tpms_pressure_fl, tpms.tpms_pressure_fl) AS "TpmsPressureFl",
                COALESCE(p.tpms_pressure_fr, tpms.tpms_pressure_fr) AS "TpmsPressureFr",
                COALESCE(p.tpms_pressure_rl, tpms.tpms_pressure_rl) AS "TpmsPressureRl",
                COALESCE(p.tpms_pressure_rr, tpms.tpms_pressure_rr) AS "TpmsPressureRr",
                COALESCE(p.tpms_soft_warning_fl, false) AS "TpmsSoftWarningFl",
                COALESCE(p.tpms_soft_warning_fr, false) AS "TpmsSoftWarningFr",
                COALESCE(p.tpms_soft_warning_rl, false) AS "TpmsSoftWarningRl",
                COALESCE(p.tpms_soft_warning_rr, false) AS "TpmsSoftWarningRr",

                p.doors_open AS "DoorsOpen",
                p.trunk_open AS "TrunkOpen",
                p.frunk_open AS "FrunkOpen",
                p.windows_open AS "WindowsOpen",
                p.is_locked AS "IsLocked",
                p.sentry_mode AS "SentryMode",
                p.is_user_present AS "IsUserPresent",

                p.is_climate_on AS "IsClimateOn",
                p.climate_keeper_mode AS "ClimateKeeperMode",
                COALESCE(p.driver_temp_setting, fallback.driver_temp_setting) AS "DriverTempSetting",
                COALESCE(p.passenger_temp_setting, fallback.passenger_temp_setting) AS "PassengerTempSetting",
                p.is_preconditioning AS "IsPreconditioning",
                p.is_front_defroster_on AS "IsFrontDefrosterOn",
                p.is_rear_defroster_on AS "IsRearDefrosterOn",

                s.state AS "State",
                u.version AS "FirmwareVersion",
                cap.current_capacity_kwh AS "CurrentCapacityKwh",
                maxcap.max_capacity_kwh AS "MaxCapacityKwh",
                COALESCE(kms.km_since_last_charge, 0) AS "KmSinceLastCharge"
            FROM cars c
            LEFT JOIN LATERAL (
                SELECT * FROM positions
                WHERE car_id = c.id
                ORDER BY date DESC
                LIMIT 1
            ) p ON true
            LEFT JOIN LATERAL (
                SELECT inside_temp, outside_temp, rated_battery_range_km, ideal_battery_range_km,
                       driver_temp_setting, passenger_temp_setting
                FROM positions
                WHERE car_id = c.id
                  AND (inside_temp IS NOT NULL OR outside_temp IS NOT NULL OR rated_battery_range_km IS NOT NULL)
                ORDER BY date DESC
                LIMIT 1
            ) fallback ON true
            LEFT JOIN LATERAL (
                SELECT tpms_pressure_fl, tpms_pressure_fr, tpms_pressure_rl, tpms_pressure_rr
                FROM positions
                WHERE car_id = c.id AND tpms_pressure_fl IS NOT NULL
                ORDER BY date DESC
                LIMIT 1
            ) tpms ON true
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
            LEFT JOIN LATERAL (
                SELECT SUM(d.distance) AS km_since_last_charge
                FROM drives d
                WHERE d.car_id = c.id
                  AND d.distance IS NOT NULL
                  AND d.start_date >= (
                      SELECT cp.end_date
                      FROM charging_processes cp
                      WHERE cp.car_id = c.id AND cp.end_date IS NOT NULL
                      ORDER BY cp.end_date DESC LIMIT 1
                  )
            ) kms ON true
            WHERE c.id = @CarId
            """, new { CarId = carId });
    }
}
