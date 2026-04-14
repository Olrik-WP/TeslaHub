using Dapper;
using TeslaHub.Api.Models;

namespace TeslaHub.Api.TeslaMate;

public static class LocationsQueries
{
    public static async Task<LocationStatsDto> GetLocationStatsAsync(this TeslaMateConnectionFactory db, int carId)
    {
        using var conn = db.CreateConnection();
        return await conn.QueryFirstAsync<LocationStatsDto>("""
            SELECT
                COUNT(*) AS "AddressCount",
                COUNT(DISTINCT city) AS "CityCount",
                COUNT(DISTINCT state) AS "StateCount",
                COUNT(DISTINCT country) AS "CountryCount"
            FROM addresses
            WHERE id IN (
                SELECT start_address_id FROM drives WHERE car_id = @CarId
                UNION
                SELECT end_address_id FROM drives WHERE car_id = @CarId
                UNION
                SELECT address_id FROM charging_processes WHERE car_id = @CarId
            )
            """, new { CarId = carId });
    }

    public static async Task<IEnumerable<VisitedLocationDto>> GetVisitedLocationsAsync(this TeslaMateConnectionFactory db, int carId, int limit = 200)
    {
        using var conn = db.CreateConnection();
        return await conn.QueryAsync<VisitedLocationDto>("""
            WITH locations AS (
                SELECT address_id, geofence_id, start_date AS visit_date
                FROM charging_processes WHERE car_id = @CarId
                UNION ALL
                SELECT end_address_id, end_geofence_id, end_date
                FROM drives WHERE car_id = @CarId
            )
            SELECT
                COALESCE(g.name, array_to_string((string_to_array(a.display_name, ', ', ''))[1:2], ', ')) AS "Address",
                COALESCE(a.city, a.neighbourhood) AS "City",
                a.state AS "State",
                a.country AS "Country",
                a.latitude AS "Latitude",
                a.longitude AS "Longitude",
                COUNT(*) AS "VisitCount",
                MAX(l.visit_date) AS "LastVisited"
            FROM locations l
            INNER JOIN addresses a ON l.address_id = a.id
            LEFT JOIN geofences g ON l.geofence_id = g.id
            GROUP BY "Address", "City", "State", "Country", a.latitude, a.longitude
            ORDER BY "VisitCount" DESC
            LIMIT @Limit
            """, new { CarId = carId, Limit = limit });
    }

    public static async Task<IEnumerable<TopCityDto>> GetTopCitiesAsync(this TeslaMateConnectionFactory db, int carId, int limit = 10)
    {
        using var conn = db.CreateConnection();
        return await conn.QueryAsync<TopCityDto>("""
            SELECT
                city AS "City",
                COUNT(*) AS "Count"
            FROM addresses
            WHERE city IS NOT NULL AND id IN (
                SELECT start_address_id FROM drives WHERE car_id = @CarId
                UNION
                SELECT end_address_id FROM drives WHERE car_id = @CarId
                UNION
                SELECT address_id FROM charging_processes WHERE car_id = @CarId
            )
            GROUP BY city
            ORDER BY "Count" DESC
            LIMIT @Limit
            """, new { CarId = carId, Limit = limit });
    }
}
