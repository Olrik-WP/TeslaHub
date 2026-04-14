using TeslaHub.Api.Services;
using TeslaHub.Api.TeslaMate;

namespace TeslaHub.Api.Endpoints;

public static class LocationsEndpoints
{
    public static void MapLocationsEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/locations").RequireAuthorization();

        group.MapGet("/{carId:int}/stats", async (int carId, TeslaMateConnectionFactory tm, CacheService cache) =>
        {
            var data = await cache.GetOrSetHistoricalAsync(
                $"loc:stats:{carId}",
                () => tm.GetLocationStatsAsync(carId));
            return Results.Ok(data);
        });

        group.MapGet("/{carId:int}/visited", async (int carId, TeslaMateConnectionFactory tm, CacheService cache) =>
        {
            var data = await cache.GetOrSetHistoricalAsync(
                $"loc:visited:{carId}",
                () => tm.GetVisitedLocationsAsync(carId));
            return Results.Ok(data);
        });

        group.MapGet("/{carId:int}/top-cities", async (int carId, TeslaMateConnectionFactory tm, CacheService cache) =>
        {
            var data = await cache.GetOrSetHistoricalAsync(
                $"loc:topcities:{carId}",
                () => tm.GetTopCitiesAsync(carId));
            return Results.Ok(data);
        });
    }
}
