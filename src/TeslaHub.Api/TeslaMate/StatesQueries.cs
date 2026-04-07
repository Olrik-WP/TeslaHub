using Dapper;
using TeslaHub.Api.Models;

namespace TeslaHub.Api.TeslaMate;

public static class StatesQueries
{
    public static async Task<StatesSummaryDto> GetStatesSummaryAsync(
        this TeslaMateConnectionFactory db, int carId, int days)
    {
        using var conn = db.CreateConnection();

        var current = await conn.QueryFirstOrDefaultAsync<string?>("""
            SELECT state FROM states WHERE car_id = @CarId ORDER BY start_date DESC LIMIT 1
            """, new { CarId = carId });

        var segments = await conn.QueryAsync<StateSegmentDto>("""
            WITH events AS (
                SELECT 'driving' AS state, start_date, end_date FROM drives WHERE car_id = @CarId AND start_date >= NOW() - INTERVAL '1 day' * @Days
                UNION ALL
                SELECT 'charging', start_date, end_date FROM charging_processes WHERE car_id = @CarId AND start_date >= NOW() - INTERVAL '1 day' * @Days
                UNION ALL
                SELECT state, start_date, end_date FROM states WHERE car_id = @CarId AND start_date >= NOW() - INTERVAL '1 day' * @Days
                UNION ALL
                SELECT 'updating', start_date, end_date FROM updates WHERE car_id = @CarId AND start_date >= NOW() - INTERVAL '1 day' * @Days
            ),
            durations AS (
                SELECT state, SUM(EXTRACT(EPOCH FROM (COALESCE(end_date, NOW()) - start_date))) AS dur
                FROM events GROUP BY state
            ),
            total AS (SELECT SUM(dur) AS total FROM durations)
            SELECT state AS "State", dur / NULLIF(total.total, 0) AS "Pct"
            FROM durations, total
            ORDER BY dur DESC
            """, new { CarId = carId, Days = days });

        var segList = segments.ToList();
        double parked = 0, driving = 0;
        foreach (var s in segList)
        {
            if (s.State is "asleep" or "offline" or "online") parked += s.Pct;
            else if (s.State == "driving") driving = s.Pct;
        }

        return new StatesSummaryDto
        {
            CurrentState = current,
            ParkedPct = parked,
            DrivingPct = driving,
            Segments = segList
        };
    }

    public static async Task<IEnumerable<TimelineEntryDto>> GetTimelineAsync(
        this TeslaMateConnectionFactory db, int carId, int days)
    {
        using var conn = db.CreateConnection();
        return await conn.QueryAsync<TimelineEntryDto>("""
            SELECT * FROM (
                SELECT
                    'driving' AS "Action",
                    d.start_date AS "StartDate",
                    d.end_date AS "EndDate",
                    d.duration_min AS "DurationMin",
                    COALESCE(sg.name, CONCAT_WS(', ', COALESCE(sa.name, NULLIF(CONCAT_WS(' ', sa.road, sa.house_number), '')), sa.city)) AS "StartAddress",
                    COALESCE(eg.name, CONCAT_WS(', ', COALESCE(ea.name, NULLIF(CONCAT_WS(' ', ea.road, ea.house_number), '')), ea.city)) AS "EndAddress",
                    d.distance AS "DistanceKm",
                    (d.start_rated_range_km - d.end_rated_range_km) * c.efficiency AS "EnergyKwh",
                    ep.battery_level AS "SocEnd"
                FROM drives d
                JOIN cars c ON d.car_id = c.id
                LEFT JOIN addresses sa ON d.start_address_id = sa.id
                LEFT JOIN addresses ea ON d.end_address_id = ea.id
                LEFT JOIN geofences sg ON d.start_geofence_id = sg.id
                LEFT JOIN geofences eg ON d.end_geofence_id = eg.id
                LEFT JOIN positions ep ON d.end_position_id = ep.id
                WHERE d.car_id = @CarId AND d.start_date >= NOW() - INTERVAL '1 day' * @Days

                UNION ALL

                SELECT
                    'charging' AS "Action",
                    cp.start_date, cp.end_date, cp.duration_min,
                    COALESCE(g.name, CONCAT_WS(', ', COALESCE(a.name, NULLIF(CONCAT_WS(' ', a.road, a.house_number), '')), a.city)),
                    NULL,
                    NULL,
                    cp.charge_energy_added,
                    cp.end_battery_level::double precision
                FROM charging_processes cp
                LEFT JOIN addresses a ON cp.address_id = a.id
                LEFT JOIN geofences g ON cp.geofence_id = g.id
                WHERE cp.car_id = @CarId AND cp.start_date >= NOW() - INTERVAL '1 day' * @Days
                  AND cp.charge_energy_added > 0

                UNION ALL

                SELECT
                    'updating' AS "Action",
                    u.start_date, u.end_date,
                    EXTRACT(EPOCH FROM (u.end_date - u.start_date)) / 60.0,
                    split_part(u.version, ' ', 1), NULL, NULL, NULL, NULL
                FROM updates u
                WHERE u.car_id = @CarId AND u.start_date >= NOW() - INTERVAL '1 day' * @Days
            ) combined
            ORDER BY "StartDate" DESC
            LIMIT 200
            """, new { CarId = carId, Days = days });
    }
}
