using Dapper;
using TeslaHub.Api.Models;

namespace TeslaHub.Api.TeslaMate;

public static class BatteryQueries
{
    public static async Task<BatteryHealthDto> GetBatteryHealthAsync(
        this TeslaMateConnectionFactory db, int carId)
    {
        using var conn = db.CreateConnection();

        var efficiency = await conn.ExecuteScalarAsync<double?>("""
            WITH eff AS (
                SELECT
                    COALESCE(
                        (SELECT ROUND((charge_energy_added / NULLIF(end_rated_range_km - start_rated_range_km, 0))::numeric, 3) * 100
                         FROM charging_processes
                         WHERE car_id = @CarId AND duration_min > 10 AND end_battery_level <= 95
                           AND start_rated_range_km IS NOT NULL AND end_rated_range_km IS NOT NULL
                           AND charge_energy_added > 0
                         GROUP BY ROUND((charge_energy_added / NULLIF(end_rated_range_km - start_rated_range_km, 0))::numeric, 3) * 100
                         ORDER BY COUNT(*) DESC LIMIT 1),
                        (SELECT efficiency * 100 FROM cars WHERE id = @CarId)
                    ) AS val
            )
            SELECT val FROM eff
            """, new { CarId = carId });

        if (efficiency == null || efficiency <= 0) efficiency = 1;

        var currentCap = await conn.ExecuteScalarAsync<double?>("""
            SELECT AVG(cap) FROM (
                SELECT c.rated_battery_range_km * @Eff / c.usable_battery_level AS cap
                FROM charging_processes cp
                INNER JOIN charges c ON c.charging_process_id = cp.id
                WHERE cp.car_id = @CarId AND cp.end_date IS NOT NULL
                  AND cp.charge_energy_added >= @Eff AND c.usable_battery_level > 0
                ORDER BY cp.end_date DESC, c.date DESC LIMIT 100
            ) sub
            """, new { CarId = carId, Eff = efficiency });

        var maxCap = await conn.ExecuteScalarAsync<double?>("""
            SELECT MAX(c.rated_battery_range_km * @Eff / c.usable_battery_level)
            FROM charging_processes cp
            INNER JOIN (
                SELECT charging_process_id, MAX(date) AS date
                FROM charges WHERE usable_battery_level > 0 GROUP BY charging_process_id
            ) gc ON cp.id = gc.charging_process_id
            INNER JOIN charges c ON c.charging_process_id = cp.id AND c.date = gc.date
            WHERE cp.car_id = @CarId AND cp.end_date IS NOT NULL
              AND cp.charge_energy_added >= @Eff
            """, new { CarId = carId, Eff = efficiency });

        var chargingStats = await conn.QueryFirstOrDefaultAsync<dynamic>("""
            SELECT
                COUNT(*) AS charge_count,
                FLOOR(SUM(charge_energy_added) / NULLIF(@MaxCap, 0)) AS cycles,
                SUM(charge_energy_added) AS energy_added,
                SUM(GREATEST(charge_energy_added, charge_energy_used)) AS energy_used
            FROM charging_processes
            WHERE car_id = @CarId AND charge_energy_added > 0.01
            """, new { CarId = carId, MaxCap = maxCap ?? 1 });

        var soc = await conn.ExecuteScalarAsync<double?>("""
            SELECT usable_battery_level FROM (
                (SELECT usable_battery_level, date FROM positions WHERE car_id = @CarId AND usable_battery_level IS NOT NULL ORDER BY date DESC LIMIT 1)
                UNION
                (SELECT usable_battery_level, date FROM charges c JOIN charging_processes p ON p.id = c.charging_process_id WHERE p.car_id = @CarId AND usable_battery_level IS NOT NULL ORDER BY date DESC LIMIT 1)
            ) sub ORDER BY date DESC LIMIT 1
            """, new { CarId = carId });

        double? degradation = null, health = null, storedEnergy = null;
        if (currentCap != null && maxCap != null && maxCap > 0)
        {
            degradation = Math.Max(0, 100.0 - currentCap.Value * 100.0 / maxCap.Value);
            health = Math.Min(100, 100 - degradation.Value);
        }
        if (soc != null && currentCap != null)
            storedEnergy = soc.Value * currentCap.Value / 100.0;

        double? effPct = null;
        double energyAdded = (double)(chargingStats?.energy_added ?? 0);
        double energyUsed = (double)(chargingStats?.energy_used ?? 0);
        if (energyUsed > 0)
            effPct = energyAdded / energyUsed;

        var capacityByMileage = await conn.QueryAsync<CapacityPointDto>("""
            SELECT
                AVG(p.odometer) AS "OdometerKm",
                AVG(c.rated_battery_range_km * @Eff / c.usable_battery_level) AS "CapacityKwh",
                to_char(cp.end_date, 'YYYY-MM-DD') AS "Date"
            FROM charging_processes cp
            JOIN (SELECT charging_process_id, MAX(date) AS date FROM charges WHERE usable_battery_level > 0 GROUP BY charging_process_id) lc
                ON cp.id = lc.charging_process_id
            INNER JOIN charges c ON c.charging_process_id = cp.id AND c.date = lc.date
            INNER JOIN positions p ON p.id = cp.position_id
            WHERE cp.car_id = @CarId AND cp.end_date IS NOT NULL
              AND cp.charge_energy_added >= @Eff
            GROUP BY to_char(cp.end_date, 'YYYY-MM-DD')
            ORDER BY "Date"
            """, new { CarId = carId, Eff = efficiency });

        var capList = capacityByMileage.ToList();
        double? median = null;
        if (capList.Count > 0)
        {
            var sorted = capList.Select(c => c.CapacityKwh).OrderBy(v => v).ToList();
            median = sorted[sorted.Count / 2];
        }

        return new BatteryHealthDto
        {
            CurrentCapacityKwh = currentCap,
            MaxCapacityKwh = maxCap,
            DegradationPct = degradation,
            HealthPct = health,
            StoredEnergyKwh = storedEnergy,
            ChargeCount = (int)(chargingStats?.charge_count ?? 0),
            ChargeCycles = (double?)(chargingStats?.cycles),
            TotalEnergyAddedKwh = energyAdded,
            TotalEnergyUsedKwh = energyUsed,
            ChargingEfficiencyPct = effPct,
            MedianCapacity = median,
            CapacityByMileage = capList
        };
    }

    public static async Task<IEnumerable<ChargeLevelPointDto>> GetChargeLevelTimeSeriesAsync(
        this TeslaMateConnectionFactory db, int carId, int days)
    {
        using var conn = db.CreateConnection();
        return await conn.QueryAsync<ChargeLevelPointDto>("""
            SELECT
                date_bin('30 minutes'::interval, date, NOW() - INTERVAL '1 day' * @Days) AS "Date",
                AVG(battery_level) AS "BatteryLevel",
                AVG(usable_battery_level) AS "UsableBatteryLevel"
            FROM positions
            WHERE car_id = @CarId AND ideal_battery_range_km IS NOT NULL
              AND date >= NOW() - INTERVAL '1 day' * @Days
            GROUP BY 1 ORDER BY 1
            """, new { CarId = carId, Days = days });
    }

    public static async Task<IEnumerable<ProjectedRangePointDto>> GetProjectedRangeTimeSeriesAsync(
        this TeslaMateConnectionFactory db, int carId, int days)
    {
        using var conn = db.CreateConnection();
        return await conn.QueryAsync<ProjectedRangePointDto>("""
            SELECT
                date_bin('1 hour'::interval, date, NOW() - INTERVAL '1 day' * @Days) AS "Date",
                (SUM(rated_battery_range_km) / NULLIF(SUM(COALESCE(usable_battery_level, battery_level)), 0) * 100) AS "ProjectedRangeKm",
                AVG(COALESCE(usable_battery_level, battery_level)) AS "BatteryLevel"
            FROM (
                SELECT battery_level, usable_battery_level, date, rated_battery_range_km
                FROM positions
                WHERE car_id = @CarId AND ideal_battery_range_km IS NOT NULL
                  AND date >= NOW() - INTERVAL '1 day' * @Days
                UNION ALL
                SELECT battery_level, COALESCE(usable_battery_level, battery_level), date, rated_battery_range_km
                FROM charges c JOIN charging_processes p ON p.id = c.charging_process_id
                WHERE p.car_id = @CarId AND date >= NOW() - INTERVAL '1 day' * @Days
            ) data
            GROUP BY 1
            HAVING SUM(COALESCE(usable_battery_level, battery_level)) > 0
            ORDER BY 1
            """, new { CarId = carId, Days = days });
    }
}