using TeslaHub.Api.Services;
using TeslaHub.Api.TeslaMate;

namespace TeslaHub.Api.Endpoints;

public static class DatabaseEndpoints
{
    public static void MapDatabaseEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/database").RequireAuthorization();

        group.MapGet("/info", async (TeslaMateConnectionFactory tm, CacheService cache) =>
        {
            var data = await cache.GetOrSetStaticAsync(
                "db:info",
                () => tm.GetDatabaseInfoAsync());
            return Results.Ok(data);
        });

        group.MapGet("/tables", async (TeslaMateConnectionFactory tm, CacheService cache) =>
        {
            var data = await cache.GetOrSetStaticAsync(
                "db:tables",
                () => tm.GetTableSizesAsync());
            return Results.Ok(data);
        });

        group.MapGet("/row-counts", async (TeslaMateConnectionFactory tm, CacheService cache) =>
        {
            var data = await cache.GetOrSetStaticAsync(
                "db:rowcounts",
                () => tm.GetTableRowCountsAsync());
            return Results.Ok(data);
        });

        group.MapGet("/indexes", async (TeslaMateConnectionFactory tm, CacheService cache) =>
        {
            var data = await cache.GetOrSetStaticAsync(
                "db:indexes",
                () => tm.GetIndexStatsAsync());
            return Results.Ok(data);
        });

        group.MapGet("/{carId:int}/stats", async (int carId, TeslaMateConnectionFactory tm, CacheService cache) =>
        {
            var data = await cache.GetOrSetHistoricalAsync(
                $"db:stats:{carId}",
                () => tm.GetDataStatsAsync(carId));
            return Results.Ok(data);
        });
    }
}
