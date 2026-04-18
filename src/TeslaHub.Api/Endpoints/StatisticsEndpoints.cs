using TeslaHub.Api.Models;
using TeslaHub.Api.Services;
using TeslaHub.Api.TeslaMate;

namespace TeslaHub.Api.Endpoints;

public static class StatisticsEndpoints
{
    public static void MapStatisticsEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/statistics").RequireAuthorization();

        group.MapGet("/{carId:int}", async (int carId, string? period, TeslaMateConnectionFactory tm, CacheService cache, CostService costService) =>
        {
            var p = period ?? CostPeriods.Month;
            var stats = await cache.GetOrSetHistoricalAsync(
                $"periodicStats:{carId}:{p}",
                () => tm.GetPeriodicStatsAsync(carId, p));

            var costs = await cache.GetOrSetHistoricalAsync(
                $"periodCosts:{carId}:{p}",
                () => costService.GetCostsGroupedByPeriodAsync(carId, p));

            var result = stats.Select(row =>
                costs.TryGetValue(row.Label, out var cost)
                    ? row with { ChargeCost = cost }
                    : row
            ).ToList();

            return Results.Ok(result);
        });
    }
}
