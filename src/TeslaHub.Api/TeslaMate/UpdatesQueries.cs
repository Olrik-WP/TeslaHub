using Dapper;
using TeslaHub.Api.Models;

namespace TeslaHub.Api.TeslaMate;

public static class UpdatesQueries
{
    public static async Task<IEnumerable<UpdateItemDto>> GetUpdatesListAsync(
        this TeslaMateConnectionFactory db, int carId)
    {
        using var conn = db.CreateConnection();
        return await conn.QueryAsync<UpdateItemDto>("""
            SELECT
                start_date AS "StartDate",
                end_date AS "EndDate",
                EXTRACT(EPOCH FROM (end_date - start_date)) / 60.0 AS "DurationMin",
                split_part(version, ' ', 1) AS "Version",
                EXTRACT(EPOCH FROM (start_date - lag(start_date) OVER (ORDER BY start_date))) / 86400.0 AS "SinceLastDays"
            FROM updates
            WHERE car_id = @CarId
            ORDER BY start_date DESC
            """, new { CarId = carId });
    }

    public static async Task<UpdatesStatsDto?> GetUpdatesStatsAsync(
        this TeslaMateConnectionFactory db, int carId)
    {
        using var conn = db.CreateConnection();
        return await conn.QueryFirstOrDefaultAsync<UpdatesStatsDto>("""
            WITH u AS (
                SELECT
                    start_date,
                    EXTRACT(EPOCH FROM (start_date - lag(start_date) OVER (ORDER BY start_date))) / 86400.0 AS since_last
                FROM updates WHERE car_id = @CarId
            )
            SELECT
                (SELECT COUNT(*) FROM updates WHERE car_id = @CarId) AS "TotalCount",
                PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY since_last) AS "MedianIntervalDays",
                (SELECT split_part(version, ' ', 1) FROM updates WHERE car_id = @CarId ORDER BY start_date DESC LIMIT 1) AS "CurrentVersion"
            FROM u
            WHERE since_last IS NOT NULL
            """, new { CarId = carId });
    }
}
