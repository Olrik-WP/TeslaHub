using TeslaHub.Api.Services;
using TeslaHub.Api.TeslaMate;

namespace TeslaHub.Api.Endpoints;

public static class StatesEndpoints
{
    public static void MapStatesEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/states").RequireAuthorization();

        group.MapGet("/{carId:int}/summary", async (int carId, int? days, TeslaMateConnectionFactory tm, CacheService cache) =>
        {
            var d = days ?? 7;
            var data = await cache.GetOrSetHistoricalAsync(
                $"statesSummary:{carId}:{d}",
                () => tm.GetStatesSummaryAsync(carId, d));
            return Results.Ok(data);
        });

        group.MapGet("/{carId:int}/timeline", async (int carId, int? days,
            TeslaMateConnectionFactory tm, CacheService cache, LocationNameService locSvc) =>
        {
            var d = days ?? 7;
            var data = await cache.GetOrSetHistoricalAsync(
                $"timeline:{carId}:{d}",
                () => tm.GetTimelineAsync(carId, d));
            var locations = await locSvc.GetLocationsAsync();
            var enriched = data?.Select(e => e with
            {
                StartAddress = locSvc.FindName(locations, (double?)e.StartLat, (double?)e.StartLng, carId) ?? e.StartAddress,
                EndAddress = locSvc.FindName(locations, (double?)e.EndLat, (double?)e.EndLng, carId) ?? e.EndAddress
            }).ToList();
            return Results.Ok(enriched);
        });
    }
}
