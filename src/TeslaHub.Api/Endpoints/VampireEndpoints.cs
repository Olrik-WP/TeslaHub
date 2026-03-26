using TeslaHub.Api.Services;
using TeslaHub.Api.TeslaMate;

namespace TeslaHub.Api.Endpoints;

public static class VampireEndpoints
{
    public static void MapVampireEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/vampire").RequireAuthorization();

        group.MapGet("/{carId:int}", async (
            int carId,
            double? minIdleHours,
            int? days,
            int? page,
            TeslaMateConnectionFactory tm,
            CacheService cache) =>
        {
            var idle = minIdleHours ?? 4.0;
            var pageSize = 50;
            var offset = ((page ?? 1) - 1) * pageSize;

            DateTime? from = days.HasValue ? DateTime.UtcNow.AddDays(-days.Value) : null;
            DateTime? to = null;

            var cacheKey = $"vampire:{carId}:{idle}:{days}:{page}";
            var summaryKey = $"vampireSummary:{carId}:{idle}:{days}";

            var items = await cache.GetOrSetHistoricalAsync(
                cacheKey,
                () => tm.GetVampireDrainAsync(carId, idle, from, to, pageSize, offset));

            var summary = await cache.GetOrSetHistoricalAsync(
                summaryKey,
                () => tm.GetVampireSummaryAsync(carId, idle, from, to));

            return Results.Ok(new { items, summary });
        });
    }
}
