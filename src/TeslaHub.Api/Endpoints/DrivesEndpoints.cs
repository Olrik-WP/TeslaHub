using TeslaHub.Api.Services;
using TeslaHub.Api.TeslaMate;

namespace TeslaHub.Api.Endpoints;

public static class DrivesEndpoints
{
    public static void MapDrivesEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/drives").RequireAuthorization();

        group.MapGet("/{carId:int}", async (int carId, int? limit, int? offset, int? days,
            TeslaMateConnectionFactory tm, CacheService cache, LocationNameService locSvc) =>
        {
            var l = limit ?? 20;
            var o = offset ?? 0;
            var drives = await cache.GetOrSetHistoricalAsync(
                $"drives:{carId}:{l}:{o}:{days}",
                () => tm.GetDrivesAsync(carId, l, o, days));
            var locations = await locSvc.GetLocationsAsync();
            var enriched = drives?.Select(d => d with
            {
                StartAddress = locSvc.FindName(locations, (double?)d.StartLat, (double?)d.StartLng, carId) ?? d.StartAddress,
                EndAddress = locSvc.FindName(locations, (double?)d.EndLat, (double?)d.EndLng, carId) ?? d.EndAddress
            }).ToList();
            return Results.Ok(enriched);
        });

        group.MapGet("/{carId:int}/stats", async (int carId, TeslaMateConnectionFactory tm, CacheService cache) =>
        {
            var stats = await cache.GetOrSetHistoricalAsync(
                $"driveStats:{carId}",
                () => tm.GetDriveStatsAsync(carId));
            return Results.Ok(stats);
        });

        group.MapGet("/positions/{driveId:int}", async (int driveId, TeslaMateConnectionFactory tm, CacheService cache) =>
        {
            var positions = await cache.GetOrSetHistoricalAsync(
                $"drivePositions:{driveId}",
                () => tm.GetDrivePositionsAsync(driveId));
            return Results.Ok(positions);
        });
    }
}
