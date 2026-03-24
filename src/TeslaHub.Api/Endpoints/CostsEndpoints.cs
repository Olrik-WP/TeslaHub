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

        group.MapGet("/rules", async (int? carId, AppDbContext db) =>
        {
            var query = db.PriceRules.AsQueryable();
            if (carId != null)
                query = query.Where(r => r.CarId == null || r.CarId == carId);
            var rules = await query.OrderBy(r => r.Priority).ToListAsync();
            return Results.Ok(rules);
        });

        group.MapPost("/rules", async (PriceRuleCreateDto dto, AppDbContext db) =>
        {
            var rule = new PriceRule
            {
                CarId = dto.CarId,
                Label = dto.Label,
                PricePerKwh = dto.PricePerKwh,
                SourceType = dto.SourceType,
                LocationName = dto.LocationName,
                GeofenceId = dto.GeofenceId,
                TimeStart = dto.TimeStart != null ? TimeOnly.Parse(dto.TimeStart) : null,
                TimeEnd = dto.TimeEnd != null ? TimeOnly.Parse(dto.TimeEnd) : null,
                ValidFrom = dto.ValidFrom,
                ValidTo = dto.ValidTo,
                Priority = dto.Priority,
                IsActive = true
            };

            db.PriceRules.Add(rule);
            await db.SaveChangesAsync();
            return Results.Created($"/api/costs/rules/{rule.Id}", rule);
        });

        group.MapPut("/rules/{id:int}", async (int id, PriceRuleCreateDto dto, AppDbContext db) =>
        {
            var rule = await db.PriceRules.FindAsync(id);
            if (rule == null) return Results.NotFound();

            rule.CarId = dto.CarId;
            rule.Label = dto.Label;
            rule.PricePerKwh = dto.PricePerKwh;
            rule.SourceType = dto.SourceType;
            rule.LocationName = dto.LocationName;
            rule.GeofenceId = dto.GeofenceId;
            rule.TimeStart = dto.TimeStart != null ? TimeOnly.Parse(dto.TimeStart) : null;
            rule.TimeEnd = dto.TimeEnd != null ? TimeOnly.Parse(dto.TimeEnd) : null;
            rule.ValidFrom = dto.ValidFrom;
            rule.ValidTo = dto.ValidTo;
            rule.Priority = dto.Priority;

            await db.SaveChangesAsync();
            return Results.Ok(rule);
        });

        group.MapDelete("/rules/{id:int}", async (int id, AppDbContext db) =>
        {
            var rule = await db.PriceRules.FindAsync(id);
            if (rule == null) return Results.NotFound();

            db.PriceRules.Remove(rule);
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        group.MapGet("/overrides/{carId:int}", async (int carId, AppDbContext db) =>
        {
            var overrides = await db.ChargingCostOverrides
                .Where(c => c.CarId == carId)
                .OrderByDescending(c => c.CreatedAt)
                .ToListAsync();
            return Results.Ok(overrides);
        });

        group.MapPost("/overrides", async (CostOverrideCreateDto dto, AppDbContext db) =>
        {
            var existing = await db.ChargingCostOverrides
                .FirstOrDefaultAsync(c => c.ChargingProcessId == dto.ChargingProcessId && c.CarId == dto.CarId);

            if (existing != null)
            {
                existing.Cost = dto.Cost;
                existing.IsFree = dto.IsFree;
                existing.SourceType = dto.SourceType;
                existing.IsManualOverride = true;
                existing.Notes = dto.Notes;
                existing.UpdatedAt = DateTime.UtcNow;
            }
            else
            {
                existing = new ChargingCostOverride
                {
                    ChargingProcessId = dto.ChargingProcessId,
                    CarId = dto.CarId,
                    Cost = dto.Cost,
                    IsFree = dto.IsFree,
                    SourceType = dto.SourceType,
                    IsManualOverride = true,
                    Notes = dto.Notes
                };
                db.ChargingCostOverrides.Add(existing);
            }

            await db.SaveChangesAsync();
            return Results.Ok(existing);
        });

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
