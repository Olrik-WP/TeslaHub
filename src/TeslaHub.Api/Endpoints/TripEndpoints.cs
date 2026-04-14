using TeslaHub.Api.Services;
using TeslaHub.Api.TeslaMate;

namespace TeslaHub.Api.Endpoints;

public static class TripEndpoints
{
    public static void MapTripEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/trip").RequireAuthorization();

        group.MapGet("/{carId:int}/summary", async (int carId, DateTime from, DateTime to, TeslaMateConnectionFactory tm) =>
        {
            var data = await tm.GetTripSummaryAsync(carId, from, to);
            return Results.Ok(data);
        });

        group.MapGet("/{carId:int}/segments", async (int carId, DateTime from, DateTime to,
            TeslaMateConnectionFactory tm, LocationNameService locSvc) =>
        {
            var data = await tm.GetTripSegmentsAsync(carId, from, to);
            var locations = await locSvc.GetLocationsAsync();
            var enriched = data?.Select(s => s with
            {
                StartAddress = locSvc.FindName(locations, (double?)s.StartLat, (double?)s.StartLng, carId) ?? s.StartAddress,
                EndAddress = locSvc.FindName(locations, (double?)s.EndLat, (double?)s.EndLng, carId) ?? s.EndAddress
            }).ToList();
            return Results.Ok(enriched);
        });
    }
}
