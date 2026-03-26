using Dapper;
using TeslaHub.Api.Models;

namespace TeslaHub.Api.TeslaMate;

public static class VampireQueries
{
    public static async Task<IEnumerable<VampireDrainDto>> GetVampireDrainAsync(
        this TeslaMateConnectionFactory db,
        int carId,
        double minIdleHours,
        DateTime? from,
        DateTime? to,
        int limit = 50,
        int offset = 0)
    {
        using var conn = db.CreateConnection();
        return await conn.QueryAsync<VampireDrainDto>("""
            WITH merge AS (
                SELECT
                    c.start_date,
                    c.end_date,
                    c.start_rated_range_km,
                    c.end_rated_range_km,
                    c.start_battery_level,
                    c.end_battery_level,
                    p.usable_battery_level AS start_usable_battery_level,
                    NULL::double precision   AS end_usable_battery_level,
                    p.odometer AS start_km,
                    p.odometer AS end_km
                FROM charging_processes c
                JOIN positions p ON c.position_id = p.id
                WHERE c.car_id = @CarId
                UNION
                SELECT
                    d.start_date,
                    d.end_date,
                    d.start_rated_range_km,
                    d.end_rated_range_km,
                    sp.battery_level        AS start_battery_level,
                    ep.battery_level        AS end_battery_level,
                    sp.usable_battery_level AS start_usable_battery_level,
                    ep.usable_battery_level AS end_usable_battery_level,
                    d.start_km,
                    d.end_km
                FROM drives d
                JOIN positions sp ON d.start_position_id = sp.id
                JOIN positions ep ON d.end_position_id   = ep.id
                WHERE d.car_id = @CarId
            ),
            v AS (
                SELECT
                    lag(t.end_date)                OVER w AS start_date,
                    t.start_date                          AS end_date,
                    lag(t.end_rated_range_km)      OVER w AS start_range,
                    t.start_rated_range_km                AS end_range,
                    lag(t.end_km)                  OVER w AS start_km,
                    t.start_km                            AS end_km,
                    EXTRACT(EPOCH FROM age(t.start_date, lag(t.end_date) OVER w)) AS duration,
                    lag(t.end_battery_level)       OVER w AS start_battery_level,
                    lag(t.end_usable_battery_level) OVER w AS start_usable_battery_level,
                    t.start_battery_level                 AS end_battery_level,
                    t.start_usable_battery_level          AS end_usable_battery_level,
                    t.start_battery_level > COALESCE(t.start_usable_battery_level, t.start_battery_level) AS has_reduced_range
                FROM merge t
                WINDOW w AS (ORDER BY t.start_date ASC)
            )
            SELECT
                v.start_date                                         AS "StartDate",
                v.end_date                                           AS "EndDate",
                v.duration                                           AS "DurationSec",
                (COALESCE(sa.sleep, 0) + COALESCE(so.sleep, 0)) / v.duration AS "Standby",
                -GREATEST(v.start_battery_level - v.end_battery_level, 0)    AS "SocDiff",
                v.has_reduced_range                                           AS "HasReducedRange",
                CASE WHEN v.has_reduced_range THEN NULL
                     ELSE ROUND((v.start_range - v.end_range)::numeric, 2)
                END AS "RangeDiffKm",
                CASE WHEN v.has_reduced_range THEN NULL
                     ELSE (v.start_range - v.end_range) * c.efficiency
                END AS "ConsumptionKwh",
                CASE WHEN v.has_reduced_range OR v.duration = 0 THEN NULL
                     ELSE ((v.start_range - v.end_range) * c.efficiency) / (v.duration / 3600.0) * 1000.0
                END AS "AvgPowerW",
                CASE WHEN v.has_reduced_range OR v.duration = 0 THEN NULL
                     ELSE ROUND(((v.start_range - v.end_range) / (v.duration / 3600.0))::numeric, 3)
                END AS "RangeLostPerHourKm"
            FROM v
            JOIN cars c ON c.id = @CarId,
            LATERAL (
                SELECT EXTRACT(EPOCH FROM SUM(age(s.end_date, s.start_date))) AS sleep
                FROM states s
                WHERE s.state = 'asleep'
                  AND v.start_date <= s.start_date AND s.end_date <= v.end_date
                  AND s.car_id = @CarId
            ) sa,
            LATERAL (
                SELECT EXTRACT(EPOCH FROM SUM(age(s.end_date, s.start_date))) AS sleep
                FROM states s
                WHERE s.state = 'offline'
                  AND v.start_date <= s.start_date AND s.end_date <= v.end_date
                  AND s.car_id = @CarId
            ) so
            WHERE v.duration > (@MinIdleHours * 3600.0)
              AND v.start_date IS NOT NULL
              AND v.start_range - v.end_range >= 0
              AND v.end_km - v.start_km < 1
              AND (@From IS NULL OR v.start_date >= @From)
              AND (@To   IS NULL OR v.start_date <= @To)
            ORDER BY v.start_date DESC
            LIMIT @Limit OFFSET @Offset
            """,
            new { CarId = carId, MinIdleHours = minIdleHours, From = from, To = to, Limit = limit, Offset = offset });
    }

    public static async Task<VampireSummaryDto> GetVampireSummaryAsync(
        this TeslaMateConnectionFactory db,
        int carId,
        double minIdleHours,
        DateTime? from,
        DateTime? to)
    {
        using var conn = db.CreateConnection();
        return await conn.QueryFirstOrDefaultAsync<VampireSummaryDto>("""
            WITH merge AS (
                SELECT
                    c.start_date, c.end_date,
                    c.start_rated_range_km, c.end_rated_range_km,
                    c.start_battery_level, c.end_battery_level,
                    p.usable_battery_level AS start_usable_battery_level,
                    NULL::double precision  AS end_usable_battery_level,
                    p.odometer AS start_km, p.odometer AS end_km
                FROM charging_processes c
                JOIN positions p ON c.position_id = p.id
                WHERE c.car_id = @CarId
                UNION
                SELECT
                    d.start_date, d.end_date,
                    d.start_rated_range_km, d.end_rated_range_km,
                    sp.battery_level, ep.battery_level,
                    sp.usable_battery_level, ep.usable_battery_level,
                    d.start_km, d.end_km
                FROM drives d
                JOIN positions sp ON d.start_position_id = sp.id
                JOIN positions ep ON d.end_position_id   = ep.id
                WHERE d.car_id = @CarId
            ),
            v AS (
                SELECT
                    lag(t.end_date)               OVER w AS start_date,
                    t.start_date                         AS end_date,
                    lag(t.end_rated_range_km)     OVER w AS start_range,
                    t.start_rated_range_km               AS end_range,
                    lag(t.end_km)                 OVER w AS start_km,
                    t.start_km                           AS end_km,
                    EXTRACT(EPOCH FROM age(t.start_date, lag(t.end_date) OVER w)) AS duration,
                    lag(t.end_battery_level)      OVER w AS start_battery_level,
                    lag(t.end_usable_battery_level) OVER w AS start_usable_battery_level,
                    t.start_battery_level                AS end_battery_level,
                    t.start_usable_battery_level         AS end_usable_battery_level,
                    t.start_battery_level > COALESCE(t.start_usable_battery_level, t.start_battery_level) AS has_reduced_range
                FROM merge t
                WINDOW w AS (ORDER BY t.start_date ASC)
            ),
            filtered AS (
                SELECT
                    CASE WHEN has_reduced_range THEN NULL
                         ELSE (start_range - end_range) * c.efficiency
                    END AS kwh,
                    CASE WHEN has_reduced_range OR duration = 0 THEN NULL
                         ELSE ((start_range - end_range) * c.efficiency) / (duration / 3600.0) * 1000.0
                    END AS avg_power_w
                FROM v
                JOIN cars c ON c.id = @CarId
                WHERE duration > (@MinIdleHours * 3600.0)
                  AND start_date IS NOT NULL
                  AND start_range - end_range >= 0
                  AND end_km - start_km < 1
                  AND (@From IS NULL OR start_date >= @From)
                  AND (@To   IS NULL OR start_date <= @To)
            )
            SELECT
                COUNT(*)                                  AS "SessionCount",
                COALESCE(SUM(kwh), 0)                    AS "TotalKwh",
                COALESCE(AVG(kwh) * 1000, 0)             AS "AvgWh",
                COALESCE(AVG(avg_power_w), 0)            AS "AvgPowerW"
            FROM filtered
            """,
            new { CarId = carId, MinIdleHours = minIdleHours, From = from, To = to })
            ?? new VampireSummaryDto();
    }
}
