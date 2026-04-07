using Dapper;
using TeslaHub.Api.Models;

namespace TeslaHub.Api.TeslaMate;

public static class MileageQueries
{
    public static async Task<IEnumerable<MileagePointDto>> GetMileageTimeSeriesAsync(
        this TeslaMateConnectionFactory db, int carId, int? days = null)
    {
        using var conn = db.CreateConnection();
        return await conn.QueryAsync<MileagePointDto>("""
            WITH o AS (
                SELECT start_date AS date, start_km AS odometer FROM drives WHERE car_id = @CarId AND start_km IS NOT NULL
                UNION ALL
                SELECT end_date AS date, end_km AS odometer FROM drives WHERE car_id = @CarId AND end_km IS NOT NULL AND end_date IS NOT NULL
            )
            SELECT date AS "Date", odometer AS "OdometerKm"
            FROM o
            WHERE (@Days IS NULL OR date >= NOW() - INTERVAL '1 day' * @Days)
            ORDER BY date
            """, new { CarId = carId, Days = days });
    }
}
