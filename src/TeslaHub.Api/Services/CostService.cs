using Microsoft.EntityFrameworkCore;
using TeslaHub.Api.Data;
using TeslaHub.Api.Models;

namespace TeslaHub.Api.Services;

public class CostService
{
    private readonly AppDbContext _db;

    public CostService(AppDbContext db)
    {
        _db = db;
    }

    public async Task<ChargingCostOverride?> CalculateCostForSession(
        ChargingSessionDto session)
    {
        var existing = await _db.ChargingCostOverrides
            .FirstOrDefaultAsync(c => c.ChargingProcessId == session.Id && c.CarId == session.CarId);

        if (existing is { IsManualOverride: true })
            return existing;

        var rules = await _db.PriceRules
            .Where(r => r.IsActive)
            .Where(r => r.CarId == null || r.CarId == session.CarId)
            .OrderBy(r => r.Priority)
            .ToListAsync();

        PriceRule? matchedRule = null;
        foreach (var rule in rules)
        {
            if (!MatchesTime(rule, session.StartDate))
                continue;
            if (!MatchesDate(rule, session.StartDate))
                continue;
            if (!MatchesLocation(rule, session))
                continue;

            matchedRule = rule;
            break;
        }

        if (matchedRule == null)
            return existing;

        var energyKwh = (decimal)(session.ChargeEnergyAdded ?? session.ChargeEnergyUsed ?? 0);
        var cost = matchedRule.PricePerKwh * energyKwh;
        var isFree = matchedRule.PricePerKwh == 0;

        var detectedSource = DetectSourceType(session);

        if (existing != null)
        {
            existing.Cost = cost;
            existing.IsFree = isFree;
            existing.SourceType = detectedSource ?? matchedRule.SourceType;
            existing.AppliedRuleId = matchedRule.Id;
            existing.IsManualOverride = false;
            existing.UpdatedAt = DateTime.UtcNow;
        }
        else
        {
            existing = new ChargingCostOverride
            {
                ChargingProcessId = session.Id,
                CarId = session.CarId,
                Cost = cost,
                IsFree = isFree,
                SourceType = detectedSource ?? matchedRule.SourceType,
                AppliedRuleId = matchedRule.Id,
                IsManualOverride = false
            };
            _db.ChargingCostOverrides.Add(existing);
        }

        await _db.SaveChangesAsync();
        return existing;
    }

    public async Task<CostSummaryDto> GetMonthlySummary(int carId, int year, int month,
        double totalDistanceKm)
    {
        var overrides = await _db.ChargingCostOverrides
            .Where(c => c.CarId == carId)
            .ToListAsync();

        var totalCost = overrides.Sum(c => c.Cost);
        var totalKwh = overrides.Sum(c => c.Cost); // will be enhanced with session join
        var sessionCount = overrides.Count;

        var costBySource = overrides
            .GroupBy(c => c.SourceType ?? "unknown")
            .ToDictionary(g => g.Key, g => g.Sum(c => c.Cost));

        return new CostSummaryDto
        {
            Period = $"{year}-{month:D2}",
            TotalCost = totalCost,
            TotalKwh = totalKwh,
            AvgPricePerKwh = totalKwh > 0 ? totalCost / totalKwh : 0,
            CostPerKm = totalDistanceKm > 0 ? totalCost / (decimal)totalDistanceKm : 0,
            TotalDistanceKm = (decimal)totalDistanceKm,
            SessionCount = sessionCount,
            CostBySourceType = costBySource
        };
    }

    private static bool MatchesTime(PriceRule rule, DateTime sessionStart)
    {
        if (rule.TimeStart == null || rule.TimeEnd == null)
            return true;

        var sessionTime = TimeOnly.FromDateTime(sessionStart);
        if (rule.TimeStart <= rule.TimeEnd)
            return sessionTime >= rule.TimeStart && sessionTime < rule.TimeEnd;

        // Overnight range (e.g. 22:00 - 06:00)
        return sessionTime >= rule.TimeStart || sessionTime < rule.TimeEnd;
    }

    private static bool MatchesDate(PriceRule rule, DateTime sessionStart)
    {
        if (rule.ValidFrom != null && sessionStart < rule.ValidFrom)
            return false;
        if (rule.ValidTo != null && sessionStart > rule.ValidTo)
            return false;
        return true;
    }

    private static bool MatchesLocation(PriceRule rule, ChargingSessionDto session)
    {
        if (rule.GeofenceId != null)
            return session.GeofenceId == rule.GeofenceId;

        if (!string.IsNullOrEmpty(rule.LocationName))
            return session.Address?.Contains(rule.LocationName, StringComparison.OrdinalIgnoreCase) == true
                || session.GeofenceName?.Contains(rule.LocationName, StringComparison.OrdinalIgnoreCase) == true;

        return true;
    }

    public static string? DetectSourceType(ChargingSessionDto session)
    {
        if (session.FastChargerPresent == true)
        {
            if (session.FastChargerType?.Contains("Tesla", StringComparison.OrdinalIgnoreCase) == true)
                return "supercharger";
            return "public";
        }
        return null;
    }
}
