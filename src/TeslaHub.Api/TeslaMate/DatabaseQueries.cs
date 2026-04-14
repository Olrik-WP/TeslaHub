using Dapper;
using TeslaHub.Api.Models;

namespace TeslaHub.Api.TeslaMate;

public static class DatabaseQueries
{
    public static async Task<DatabaseInfoDto> GetDatabaseInfoAsync(this TeslaMateConnectionFactory db)
    {
        using var conn = db.CreateConnection();
        return await conn.QueryFirstAsync<DatabaseInfoDto>("""
            SELECT
                regexp_replace(version(), 'PostgreSQL ([^ ]+) .*', '\1') AS "PostgresVersion",
                (SELECT current_setting('timezone')) AS "Timezone",
                (SELECT cast(setting as bigint) * 8 * 1024 FROM pg_catalog.pg_settings WHERE name = 'shared_buffers') AS "SharedBuffersBytes",
                (SELECT SUM(pg_total_relation_size(relid)) FROM pg_catalog.pg_statio_user_tables) AS "TotalSizeBytes"
            """);
    }

    public static async Task<IEnumerable<TableSizeDto>> GetTableSizesAsync(this TeslaMateConnectionFactory db)
    {
        using var conn = db.CreateConnection();
        return await conn.QueryAsync<TableSizeDto>("""
            SELECT
                relname AS "TableName",
                pg_relation_size(relid) AS "DataBytes",
                pg_indexes_size(relid) AS "IndexBytes",
                pg_total_relation_size(relid) AS "TotalBytes"
            FROM pg_catalog.pg_statio_user_tables
            ORDER BY pg_total_relation_size(relid) DESC
            """);
    }

    public static async Task<IEnumerable<TableRowCountDto>> GetTableRowCountsAsync(this TeslaMateConnectionFactory db)
    {
        using var conn = db.CreateConnection();
        return await conn.QueryAsync<TableRowCountDto>("""
            SELECT
                table_name AS "TableName",
                (xpath('/row/cnt/text()', query_to_xml(
                    format('SELECT count(*) as cnt FROM %I.%I', table_schema, table_name),
                    false, true, ''))
                )[1]::text::bigint AS "RowCount"
            FROM information_schema.tables
            WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
              AND table_type = 'BASE TABLE'
            ORDER BY 2 DESC
            """);
    }

    public static async Task<IEnumerable<IndexStatDto>> GetIndexStatsAsync(this TeslaMateConnectionFactory db)
    {
        using var conn = db.CreateConnection();
        return await conn.QueryAsync<IndexStatDto>("""
            SELECT
                relname AS "TableName",
                indexrelname AS "IndexName",
                idx_scan AS "IndexScans",
                idx_tup_read AS "TuplesRead",
                idx_tup_fetch AS "TuplesFetched",
                pg_relation_size(indexrelid) AS "IndexSizeBytes"
            FROM pg_stat_all_indexes
            WHERE schemaname NOT LIKE 'pg_%'
              AND indexrelname IS NOT NULL
            ORDER BY idx_scan DESC
            """);
    }

    public static async Task<DataStatsDto> GetDataStatsAsync(this TeslaMateConnectionFactory db, int carId)
    {
        using var conn = db.CreateConnection();
        return await conn.QueryFirstAsync<DataStatsDto>("""
            SELECT
                (SELECT COUNT(*) FROM drives WHERE car_id = @CarId) AS "DriveCount",
                (SELECT COUNT(*) FROM charging_processes WHERE car_id = @CarId) AS "ChargeCount",
                (SELECT COUNT(*) FROM updates WHERE car_id = @CarId) AS "UpdateCount",
                (SELECT ROUND(SUM(distance)::numeric, 1) FROM drives WHERE car_id = @CarId) AS "TotalDistanceKm",
                (SELECT ROUND(MAX(end_km)::numeric, 1) FROM drives WHERE car_id = @CarId) AS "OdometerKm",
                (SELECT split_part(version, ' ', 1) FROM updates WHERE car_id = @CarId ORDER BY start_date DESC LIMIT 1) AS "CurrentFirmware",
                (SELECT COUNT(*) FROM drives WHERE car_id = @CarId AND end_date IS NULL) AS "UnclosedDrives",
                (SELECT COUNT(*) FROM charging_processes WHERE car_id = @CarId AND end_date IS NULL) AS "UnclosedCharges"
            """, new { CarId = carId });
    }
}
