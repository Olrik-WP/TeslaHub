using Microsoft.EntityFrameworkCore;
using TeslaHub.Api.Data;
using TeslaHub.Api.Models;
using TeslaHub.Api.Services;
using TeslaHub.Api.TeslaMate;

namespace TeslaHub.Api.Endpoints;

public static class CostsEndpoints
{
    public static void MapCostsEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/costs").RequireAuthorization();

        // ─── Locations ─────────────────────────────────────────────

        group.MapGet("/locations", async (int? carId, AppDbContext db) =>
        {
            var query = db.ChargingLocations.AsQueryable();
            if (carId != null)
                query = query.Where(l => l.CarId == null || l.CarId == carId);
            return Results.Ok(await query.OrderBy(l => l.Name).ToListAsync());
        });

        group.MapPost("/locations", async (ChargingLocationCreateDto dto, AppDbContext db, CostService costService) =>
        {
            var location = new ChargingLocation
            {
                Name = dto.Name,
                Latitude = dto.Latitude,
                Longitude = dto.Longitude,
                RadiusMeters = dto.RadiusMeters,
                PricingType = dto.PricingType,
                PeakPricePerKwh = dto.PeakPricePerKwh,
                OffPeakPricePerKwh = dto.OffPeakPricePerKwh,
                OffPeakStart = dto.OffPeakStart != null ? TimeOnly.Parse(dto.OffPeakStart) : null,
                OffPeakEnd = dto.OffPeakEnd != null ? TimeOnly.Parse(dto.OffPeakEnd) : null,
                MonthlySubscription = dto.MonthlySubscription,
                CarId = dto.CarId
            };

            db.ChargingLocations.Add(location);
            await db.SaveChangesAsync();

            var applied = await costService.ApplyLocationPricingAsync(location);
            return Results.Created($"/api/costs/locations/{location.Id}", new { location, sessionsUpdated = applied });
        });

        group.MapPut("/locations/{id:int}", async (int id, ChargingLocationCreateDto dto, AppDbContext db, CostService costService) =>
        {
            var location = await db.ChargingLocations.FindAsync(id);
            if (location == null) return Results.NotFound();

            location.Name = dto.Name;
            location.Latitude = dto.Latitude;
            location.Longitude = dto.Longitude;
            location.RadiusMeters = dto.RadiusMeters;
            location.PricingType = dto.PricingType;
            location.PeakPricePerKwh = dto.PeakPricePerKwh;
            location.OffPeakPricePerKwh = dto.OffPeakPricePerKwh;
            location.OffPeakStart = dto.OffPeakStart != null ? TimeOnly.Parse(dto.OffPeakStart) : null;
            location.OffPeakEnd = dto.OffPeakEnd != null ? TimeOnly.Parse(dto.OffPeakEnd) : null;
            location.MonthlySubscription = dto.MonthlySubscription;
            location.CarId = dto.CarId;
            location.UpdatedAt = DateTime.UtcNow;

            await db.SaveChangesAsync();

            var applied = await costService.ApplyLocationPricingAsync(location);
            return Results.Ok(new { location, sessionsUpdated = applied });
        });

        group.MapDelete("/locations/{id:int}", async (int id, AppDbContext db) =>
        {
            var location = await db.ChargingLocations.FindAsync(id);
            if (location == null) return Results.NotFound();
            db.ChargingLocations.Remove(location);
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        // ─── Session costs (inline from Charging page) ────────────

        group.MapPost("/session", async (SessionCostDto dto, CostService costService) =>
        {
            var result = await costService.SetSessionCost(dto);
            return Results.Ok(result);
        });

        group.MapGet("/overrides/{carId:int}", async (int carId, AppDbContext db) =>
        {
            var overrides = await db.ChargingCostOverrides
                .Include(c => c.Location)
                .Where(c => c.CarId == carId)
                .OrderByDescending(c => c.CreatedAt)
                .ToListAsync();
            return Results.Ok(overrides);
        });

        group.MapGet("/suggest-price", async (double lat, double lng, int carId, CostService costService) =>
        {
            var price = await costService.GetLastPriceAtLocation(lat, lng, carId);
            return Results.Ok(new { suggestedPrice = price });
        });

        group.MapGet("/match-location", async (double lat, double lng, int? carId, CostService costService) =>
        {
            var location = await costService.FindMatchingLocation(lat, lng, carId);
            return Results.Ok(location);
        });

        // ─── Analytics ─────────────────────────────────────────────

        group.MapGet("/summary/{carId:int}", async (int carId, string? period, int? year, int? month,
            CostService costService, TeslaMateConnectionFactory tm) =>
        {
            var p = period ?? "month";
            var y = year ?? DateTime.UtcNow.Year;
            var m = month ?? DateTime.UtcNow.Month;
            var (start, end, _) = CostService.ComputeDateRange(p, y, m);
            var dist = await tm.GetTotalDistanceAsync(carId, start, end);
            var summary = await costService.GetSummary(carId, p, y, m, dist);
            return Results.Ok(summary);
        });

        // ─── TeslaMate cost analytics ────────────────────────────────

        group.MapGet("/teslamate-summary/{carId:int}", async (int carId, string? period, int? year, int? month,
            TeslaMateConnectionFactory tm, CacheService cache) =>
        {
            var p = period ?? "month";
            var y = year ?? DateTime.UtcNow.Year;
            var m = month ?? DateTime.UtcNow.Month;
            var (start, end, label) = CostService.ComputeDateRange(p, y, m);
            var dist = await tm.GetTotalDistanceAsync(carId, start, end);
            var summary = await cache.GetOrSetHistoricalAsync(
                $"tmCostSummary:{carId}:{p}:{y}:{m}",
                () => tm.GetTeslaMateCostSummaryAsync(carId, start, end, label, dist));
            return Results.Ok(summary);
        });

        group.MapGet("/teslamate-trend/{carId:int}", async (int carId,
            TeslaMateConnectionFactory tm, CacheService cache) =>
        {
            var trend = await cache.GetOrSetHistoricalAsync(
                $"tmCostTrend:{carId}",
                () => tm.GetTeslaMateMonthlyTrendAsync(carId));
            return Results.Ok(trend);
        });

        // ─── Settings ──────────────────────────────────────────────

        group.MapGet("/settings", async (AppDbContext db) =>
        {
            var settings = await db.GlobalSettings.FirstOrDefaultAsync();
            return Results.Ok(settings);
        });

        group.MapPut("/settings", async (GlobalSettings update, AppDbContext db) =>
        {
            var settings = await db.GlobalSettings.FirstOrDefaultAsync();
            if (settings == null) return Results.NotFound();

            settings.Currency = update.Currency;
            settings.UnitOfLength = update.UnitOfLength;
            settings.UnitOfTemperature = update.UnitOfTemperature;
            settings.DefaultCarId = update.DefaultCarId;
            settings.CostSource = update.CostSource;

            await db.SaveChangesAsync();
            return Results.Ok(settings);
        });
    }
}
