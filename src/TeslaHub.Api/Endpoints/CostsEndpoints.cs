using Microsoft.EntityFrameworkCore;
using TeslaHub.Api.Data;
using TeslaHub.Api.Models;
using TeslaHub.Api.Services;
using TeslaHub.Api.TeslaMate;
using TeslaHub.Api.Utilities;

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

        // Deleting a location must NEVER lose previously-recorded session
        // costs. There are two real-world scenarios we have to handle:
        //
        //   1. The user is merging a duplicate (e.g. Maison(CarId=NULL) and
        //      Maison(CarId=A) sitting at the exact same coordinates). We
        //      detect a "twin" location by lat/lng inside the radius and
        //      re-point every linked ChargingCostOverride to it. After the
        //      delete, AutoApplyAllLocationsPricingAsync will re-compute
        //      auto-applied prices against the surviving twin, while manual
        //      overrides keep their TotalCost untouched — only the FK moves.
        //
        //   2. No twin exists. We set LocationId to NULL on every linked
        //      override so the underlying cost rows stay intact (just
        //      detached from the location label) and the FK constraint stops
        //      blocking the DELETE. Without this we'd hit a 23503 from
        //      Postgres on FK_ChargingCostOverrides_ChargingLocations_LocationId.
        group.MapDelete("/locations/{id:int}", async (int id, AppDbContext db) =>
        {
            var location = await db.ChargingLocations.FindAsync(id);
            if (location == null) return Results.NotFound();

            var others = await db.ChargingLocations
                .Where(l => l.Id != id)
                .ToListAsync();

            // Treat any other location whose centre falls within the larger of
            // the two radii as the same physical place. Prefer a CarId=NULL
            // ("all vehicles") twin so merging always lands on the most
            // permissive entry — that's almost always what the user wants.
            var successor = others
                .Where(l => GeoDistance.HaversineMeters(
                    l.Latitude, l.Longitude, location.Latitude, location.Longitude)
                    <= Math.Max(l.RadiusMeters, location.RadiusMeters))
                .OrderBy(l => l.CarId == null ? 0 : 1)
                .ThenBy(l => l.Id)
                .FirstOrDefault();

            var linkedOverrides = await db.ChargingCostOverrides
                .Where(c => c.LocationId == id)
                .ToListAsync();

            foreach (var ovr in linkedOverrides)
            {
                ovr.LocationId = successor?.Id;
                ovr.UpdatedAt = DateTime.UtcNow;
            }

            db.ChargingLocations.Remove(location);
            await db.SaveChangesAsync();
            return Results.Ok(new
            {
                deletedId = id,
                successorId = successor?.Id,
                overridesReassigned = linkedOverrides.Count
            });
        });

        // ─── Session costs (inline from Charging page) ────────────

        group.MapPost("/session", async (SessionCostDto dto, CostService costService) =>
        {
            var result = await costService.SetSessionCost(dto);
            return Results.Ok(result);
        });

        group.MapGet("/overrides/{carId:int}", async (int carId, AppDbContext db, CostService costService) =>
        {
            await costService.AutoApplyAllLocationsPricingAsync(carId);

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
            DateTime? from, DateTime? to,
            CostService costService, TeslaMateConnectionFactory tm) =>
        {
            var p = period ?? CostPeriods.Month;
            var y = year ?? DateTime.UtcNow.Year;
            var m = month ?? DateTime.UtcNow.Month;
            var (start, end, _) = CostService.ComputeDateRange(p, y, m, from, to);
            var dist = await tm.GetTotalDistanceAsync(carId, start, end);
            var summary = await costService.GetSummary(carId, p, y, m, dist, from, to);
            return Results.Ok(summary);
        });

        // ─── TeslaMate cost analytics ────────────────────────────────

        group.MapGet("/teslamate-summary/{carId:int}", async (int carId, string? period, int? year, int? month,
            DateTime? from, DateTime? to,
            TeslaMateConnectionFactory tm, CacheService cache) =>
        {
            var p = period ?? CostPeriods.Month;
            var y = year ?? DateTime.UtcNow.Year;
            var m = month ?? DateTime.UtcNow.Month;
            var (start, end, label) = CostService.ComputeDateRange(p, y, m, from, to);
            var dist = await tm.GetTotalDistanceAsync(carId, start, end);
            var cacheKey = p == CostPeriods.Custom
                ? $"tmCostSummary:{carId}:{p}:{from:yyyyMMdd}:{to:yyyyMMdd}"
                : $"tmCostSummary:{carId}:{p}:{y}:{m}";
            var summary = await cache.GetOrSetHistoricalAsync(
                cacheKey,
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
            settings.UnitOfPressure = update.UnitOfPressure;
            settings.DefaultCarId = update.DefaultCarId;
            settings.CostSource = update.CostSource;
            settings.Language = update.Language;
            settings.DashboardGaugeMode = update.DashboardGaugeMode;
            settings.DashboardColorPreset = update.DashboardColorPreset;
            settings.DashboardMaxScale = update.DashboardMaxScale;
            settings.MapStyle = update.MapStyle;
            settings.SecurityAlertsTeaserDismissed = update.SecurityAlertsTeaserDismissed;
            settings.ChargersEnabled = update.ChargersEnabled;
            settings.ChargersNetworkFilter = string.IsNullOrWhiteSpace(update.ChargersNetworkFilter)
                ? "all"
                : update.ChargersNetworkFilter;
            settings.ChargersCustomNetworks = update.ChargersCustomNetworks;
            settings.ChargersMinPowerKw = Math.Max(0, update.ChargersMinPowerKw);
            settings.ChargersOcmApiKey = string.IsNullOrWhiteSpace(update.ChargersOcmApiKey)
                ? null
                : update.ChargersOcmApiKey.Trim();
            settings.ShowFleetApiCost = update.ShowFleetApiCost;

            await db.SaveChangesAsync();
            return Results.Ok(settings);
        });

        // ─── Car Config (per-vehicle settings) ──────────────────

        group.MapGet("/car-config/{carId:int}", async (int carId, AppDbContext db) =>
        {
            var config = await db.CarConfigs.FirstOrDefaultAsync(c => c.CarId == carId);
            if (config == null)
            {
                config = new CarConfig { CarId = carId };
                db.CarConfigs.Add(config);
                await db.SaveChangesAsync();
            }
            return Results.Ok(config);
        });

        group.MapPut("/car-config/{carId:int}", async (int carId, CarConfig update, AppDbContext db) =>
        {
            var config = await db.CarConfigs.FirstOrDefaultAsync(c => c.CarId == carId);
            if (config == null)
            {
                config = new CarConfig { CarId = carId };
                db.CarConfigs.Add(config);
            }

            config.DisplayName = update.DisplayName;
            config.ColorOverride = update.ColorOverride;
            config.IsActive = update.IsActive;
            config.GasPricePerLiter = update.GasPricePerLiter;
            config.GasConsumptionLPer100Km = update.GasConsumptionLPer100Km;
            config.GasVehicleName = update.GasVehicleName;

            await db.SaveChangesAsync();
            return Results.Ok(config);
        });
    }
}
