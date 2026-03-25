using Microsoft.EntityFrameworkCore;
using TeslaHub.Api.Data;
using TeslaHub.Api.Models;
using TeslaHub.Api.Services;

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

        group.MapPost("/locations", async (ChargingLocationCreateDto dto, AppDbContext db) =>
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
            return Results.Created($"/api/costs/locations/{location.Id}", location);
        });

        group.MapPut("/locations/{id:int}", async (int id, ChargingLocationCreateDto dto, AppDbContext db) =>
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
            return Results.Ok(location);
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
            var result = await costService.SetSessionCost(dto, null);
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

        group.MapGet("/summary/{carId:int}", async (int carId, int? year, int? month, CostService costService) =>
        {
            var y = year ?? DateTime.UtcNow.Year;
            var m = month ?? DateTime.UtcNow.Month;
            var summary = await costService.GetMonthlySummary(carId, y, m, 0);
            return Results.Ok(summary);
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

            await db.SaveChangesAsync();
            return Results.Ok(settings);
        });
    }
}
