using TeslaHub.Api.Services;
using TeslaHub.Api.TeslaMate;

namespace TeslaHub.Api.Endpoints;

public static class DrivesEndpoints
{
    public static void MapDrivesEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/drives").RequireAuthorization();

        group.MapGet("/{carId:int}", async (int carId, int? limit, int? offset, TeslaMateConnectionFactory tm, CacheService cache) =>
        {
            var l = limit ?? 20;
            var o = offset ?? 0;
            var drives = await cache.GetOrSetHistoricalAsync(
                $"drives:{carId}:{l}:{o}",
                () => tm.GetDrivesAsync(carId, l, o));
            return Results.Ok(drives);
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
