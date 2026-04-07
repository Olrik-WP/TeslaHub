using Microsoft.EntityFrameworkCore;
using TeslaHub.Api.Data;
using TeslaHub.Api.Models;
using TeslaHub.Api.TeslaMate;

namespace TeslaHub.Api.Services;

public class CostService
{
    private readonly AppDbContext _db;
    private readonly TeslaMateConnectionFactory _tm;

    public CostService(AppDbContext db, TeslaMateConnectionFactory tm)
    {
        _db = db;
        _tm = tm;
    }

    public async Task<ChargingLocation?> FindMatchingLocation(double? lat, double? lng, int? carId)
    {
        if (lat == null || lng == null)
            return null;

        var locations = await _db.ChargingLocations
            .Where(l => l.CarId == null || l.CarId == carId)
            .ToListAsync();

        foreach (var loc in locations)
        {
            var distance = HaversineMeters(lat.Value, lng.Value, loc.Latitude, loc.Longitude);
            if (distance <= loc.RadiusMeters)
                return loc;
        }

        return null;
    }

    public decimal? CalculatePricePerKwh(ChargingLocation location, DateTime sessionStart)
    {
        return location.PricingType switch
        {
            "home" => IsOffPeak(location, sessionStart)
                ? location.OffPeakPricePerKwh ?? location.PeakPricePerKwh
                : location.PeakPricePerKwh,
            "subscription" => null,
            _ => null
        };
    }

    public async Task<ChargingCostOverride> SetSessionCost(SessionCostDto dto)
    {
        var existing = await _db.ChargingCostOverrides
            .FirstOrDefaultAsync(c => c.ChargingProcessId == dto.ChargingProcessId && c.CarId == dto.CarId);

        var energyKwh = dto.EnergyKwh;

        decimal? pricePerKwh;
        decimal totalCost;

        if (dto.IsFree)
        {
            pricePerKwh = 0;
            totalCost = 0;
        }
        else if (dto.TotalCost.HasValue)
        {
            totalCost = dto.TotalCost.Value;
            pricePerKwh = energyKwh > 0 ? Math.Round(totalCost / (decimal)energyKwh.Value, 4) : dto.PricePerKwh;
        }
        else
        {
            pricePerKwh = dto.PricePerKwh;
            totalCost = (pricePerKwh ?? 0) * (decimal)(energyKwh ?? 0);
        }

        var matchedLocation = await FindMatchingLocation(dto.Latitude, dto.Longitude, dto.CarId);

        if (existing != null)
        {
            existing.PricePerKwh = pricePerKwh;
            existing.TotalCost = totalCost;
            existing.IsFree = dto.IsFree;
            existing.IsManualOverride = true;
            existing.Notes = dto.Notes;
            existing.LocationId = matchedLocation?.Id ?? existing.LocationId;
            existing.UpdatedAt = DateTime.UtcNow;
        }
        else
        {
            existing = new ChargingCostOverride
            {
                ChargingProcessId = dto.ChargingProcessId,
                CarId = dto.CarId,
                PricePerKwh = pricePerKwh,
                TotalCost = totalCost,
                IsFree = dto.IsFree,
                IsManualOverride = true,
                Notes = dto.Notes,
                LocationId = matchedLocation?.Id
            };
            _db.ChargingCostOverrides.Add(existing);
        }

        await _db.SaveChangesAsync();
        return existing;
    }

    public async Task<CostSummaryDto> GetSummary(int carId, string period, int year, int month, double totalDistanceKm,
        DateTime? customFrom = null, DateTime? customTo = null)
    {
        var (start, end, label) = ComputeDateRange(period, year, month, customFrom, customTo);

        var query = _db.ChargingCostOverrides
            .Include(c => c.Location)
            .Where(c => c.CarId == carId);

        if (start.HasValue)
            query = query.Where(c => c.CreatedAt >= start.Value);
        if (end.HasValue)
            query = query.Where(c => c.CreatedAt < end.Value);

        var overrides = await query.ToListAsync();

        var sessionCost = overrides.Sum(c => c.TotalCost);
        var totalKwh = overrides
            .Where(c => c.PricePerKwh > 0 && !c.IsFree)
            .Sum(c => c.PricePerKwh > 0 ? c.TotalCost / c.PricePerKwh.Value : 0);
        var sessionCount = overrides.Count;
        var freeCount = overrides.Count(c => c.IsFree || c.TotalCost == 0);

        var subscriptionCost = await CalculateSubscriptionTotal(carId, start, end);
        var totalCost = sessionCost + subscriptionCost;

        var costByLocation = overrides
            .GroupBy(c => c.Location?.Name ?? "Other")
            .ToDictionary(g => g.Key, g => g.Sum(c => c.TotalCost));

        foreach (var loc in await GetSubscriptionLocationsWithSessions(carId, start, end))
        {
            var existing = costByLocation.GetValueOrDefault(loc.Name, 0);
            costByLocation[loc.Name] = existing + loc.Cost;
        }

        return new CostSummaryDto
        {
            Period = label,
            TotalCost = totalCost,
            TotalKwh = totalKwh,
            AvgPricePerKwh = totalKwh > 0 ? Math.Round(sessionCost / totalKwh, 4) : 0,
            CostPerKm = totalDistanceKm > 0 ? Math.Round(totalCost / (decimal)totalDistanceKm, 4) : 0,
            TotalDistanceKm = (decimal)totalDistanceKm,
            SessionCount = sessionCount,
            FreeSessionCount = freeCount,
            CostByLocation = costByLocation,
            SubscriptionCost = subscriptionCost
        };
    }

    /// <summary>
    /// Calculate the total subscription cost for the period.
    /// Each subscription location is charged once per month where at least one session exists.
    /// </summary>
    private async Task<decimal> CalculateSubscriptionTotal(int carId, DateTime? start, DateTime? end)
    {
        var subLocations = await _db.ChargingLocations
            .Where(l => (l.CarId == null || l.CarId == carId)
                && l.PricingType == "subscription" && l.MonthlySubscription != null)
            .ToListAsync();

        if (subLocations.Count == 0)
            return 0;

        decimal total = 0;
        foreach (var loc in subLocations)
        {
            var sessionsQuery = _db.ChargingCostOverrides
                .Where(c => c.CarId == carId && c.LocationId == loc.Id);

            if (start.HasValue)
                sessionsQuery = sessionsQuery.Where(c => c.CreatedAt >= start.Value);
            if (end.HasValue)
                sessionsQuery = sessionsQuery.Where(c => c.CreatedAt < end.Value);

            var sessionDates = await sessionsQuery
                .Select(c => c.CreatedAt)
                .ToListAsync();

            var distinctMonths = sessionDates
                .Select(d => new { d.Year, d.Month })
                .Distinct()
                .Count();

            total += loc.MonthlySubscription!.Value * distinctMonths;
        }

        return total;
    }

    private async Task<List<(string Name, decimal Cost)>> GetSubscriptionLocationsWithSessions(
        int carId, DateTime? start, DateTime? end)
    {
        var subLocations = await _db.ChargingLocations
            .Where(l => (l.CarId == null || l.CarId == carId)
                && l.PricingType == "subscription" && l.MonthlySubscription != null)
            .ToListAsync();

        var results = new List<(string Name, decimal Cost)>();
        foreach (var loc in subLocations)
        {
            var sessionsQuery = _db.ChargingCostOverrides
                .Where(c => c.CarId == carId && c.LocationId == loc.Id);
            if (start.HasValue) sessionsQuery = sessionsQuery.Where(c => c.CreatedAt >= start.Value);
            if (end.HasValue) sessionsQuery = sessionsQuery.Where(c => c.CreatedAt < end.Value);

            var distinctMonths = (await sessionsQuery.Select(c => c.CreatedAt).ToListAsync())
                .Select(d => new { d.Year, d.Month }).Distinct().Count();

            if (distinctMonths > 0)
                results.Add((loc.Name, loc.MonthlySubscription!.Value * distinctMonths));
        }
        return results;
    }

    public static (DateTime? Start, DateTime? End, string Label) ComputeDateRange(
        string period, int year, int month,
        DateTime? customFrom = null, DateTime? customTo = null)
    {
        var today = DateTime.UtcNow.Date;
        return period switch
        {
            "day" => (today, today.AddDays(1), today.ToString("yyyy-MM-dd")),
            "week" => (today.AddDays(-6), today.AddDays(1), "Last 7 days"),
            "year" => (
                new DateTime(year, 1, 1, 0, 0, 0, DateTimeKind.Utc),
                new DateTime(year + 1, 1, 1, 0, 0, 0, DateTimeKind.Utc),
                $"{year}"),
            "custom" when customFrom.HasValue && customTo.HasValue => (
                customFrom.Value.Date,
                customTo.Value.Date.AddDays(1),
                $"{customFrom.Value:yyyy-MM-dd} → {customTo.Value:yyyy-MM-dd}"),
            "all" => (null, null, "All time"),
            _ => (
                new DateTime(year, month, 1, 0, 0, 0, DateTimeKind.Utc),
                new DateTime(year, month, 1, 0, 0, 0, DateTimeKind.Utc).AddMonths(1),
                $"{year}-{month:D2}")
        };
    }

    public async Task<Dictionary<string, decimal>> GetCostsGroupedByPeriodAsync(int carId, string periodType)
    {
        var overrides = await _db.ChargingCostOverrides
            .Where(c => c.CarId == carId)
            .Select(c => new { c.ChargingProcessId, c.TotalCost, c.LocationId })
            .ToListAsync();

        if (overrides.Count == 0)
            return new Dictionary<string, decimal>();

        var processIds = overrides.Select(o => o.ChargingProcessId).Distinct().ToArray();

        using var conn = _tm.CreateConnection();
        var sessionDates = (await Dapper.SqlMapper.QueryAsync<(int Id, DateTime StartDate)>(
            conn,
            "SELECT id, start_date FROM charging_processes WHERE id = ANY(@Ids)",
            new { Ids = processIds }))
            .ToDictionary(r => r.Id, r => r.StartDate);

        var result = overrides
            .GroupBy(c =>
            {
                var date = sessionDates.TryGetValue(c.ChargingProcessId, out var d) ? d : DateTime.UtcNow;
                return FormatPeriodLabel(date, periodType);
            })
            .ToDictionary(g => g.Key, g => g.Sum(c => c.TotalCost));

        if (periodType is "month" or "year")
        {
            var subLocations = await _db.ChargingLocations
                .Where(l => (l.CarId == null || l.CarId == carId)
                    && l.PricingType == "subscription" && l.MonthlySubscription != null)
                .ToListAsync();

            foreach (var loc in subLocations)
            {
                var locOverrides = await _db.ChargingCostOverrides
                    .Where(c => c.CarId == carId && c.LocationId == loc.Id)
                    .Select(c => c.ChargingProcessId)
                    .ToListAsync();

                var sessionMonths = locOverrides
                    .Select(pid => sessionDates.TryGetValue(pid, out var d) ? d : (DateTime?)null)
                    .Where(d => d != null)
                    .Select(d => new DateTime(d!.Value.Year, d.Value.Month, 1, 0, 0, 0, DateTimeKind.Utc))
                    .Distinct();

                foreach (var month in sessionMonths)
                {
                    var key = periodType == "year"
                        ? month.ToString("yyyy")
                        : month.ToString("yyyy-MM");

                    result.TryGetValue(key, out var existing);
                    result[key] = existing + loc.MonthlySubscription!.Value;
                }
            }
        }

        return result;
    }

    private static string FormatPeriodLabel(DateTime date, string periodType)
    {
        return periodType switch
        {
            "year" => date.ToString("yyyy"),
            "day" => date.ToString("yyyy-MM-dd"),
            "week" => $"W{System.Globalization.ISOWeek.GetWeekOfYear(date):D2} {System.Globalization.ISOWeek.GetYear(date)}",
            _ => date.ToString("yyyy-MM")
        };
    }

    public async Task<decimal?> GetLastPriceAtLocation(double? lat, double? lng, int carId)
    {
        if (lat == null || lng == null)
            return null;

        var location = await FindMatchingLocation(lat, lng, carId);
        if (location == null)
            return null;

        var lastOverride = await _db.ChargingCostOverrides
            .Where(c => c.LocationId == location.Id && c.CarId == carId && c.PricePerKwh != null)
            .OrderByDescending(c => c.CreatedAt)
            .FirstOrDefaultAsync();

        if (lastOverride?.PricePerKwh != null)
            return lastOverride.PricePerKwh;

        return location.PeakPricePerKwh;
    }

    /// <summary>
    /// Auto-apply pricing for ALL saved locations for a specific car.
    /// Only creates overrides for sessions that have NO existing override,
    /// so repeated calls on page load are fast no-ops.
    /// </summary>
    public async Task<int> AutoApplyAllLocationsPricingAsync(int carId)
    {
        var locations = await _db.ChargingLocations
            .Where(l => l.CarId == null || l.CarId == carId)
            .Where(l => l.PricingType == "home" || l.PricingType == "subscription")
            .ToListAsync();

        var total = 0;
        foreach (var location in locations)
        {
            var onlyNew = location.PricingType != "subscription";
            total += await ApplyLocationPricingAsync(location, onlyNewSessions: onlyNew, scopeCarId: carId);
        }

        return total;
    }

    /// <summary>
    /// Auto-apply location pricing to matching charging sessions.
    /// When <paramref name="scopeCarId"/> is set, only that car is processed (used by page-load auto-apply).
    /// When <paramref name="onlyNewSessions"/> is true, sessions that already have ANY override are skipped (fast path).
    /// When false, only sessions with a manual override are skipped, allowing price updates to propagate.
    /// </summary>
    public async Task<int> ApplyLocationPricingAsync(
        ChargingLocation location, bool onlyNewSessions = false, int? scopeCarId = null)
    {
        int[] carIds;
        if (scopeCarId.HasValue)
            carIds = new[] { scopeCarId.Value };
        else if (location.CarId.HasValue)
            carIds = new[] { location.CarId.Value };
        else
            carIds = (await _tm.GetCarIdsAsync()).ToArray();

        var created = 0;

        foreach (var carId in carIds)
        {
            var sessions = await _tm.GetChargingSessionsForLocationAsync(
                carId, location.Latitude, location.Longitude, location.RadiusMeters);

            var existingProcessIds = (await _db.ChargingCostOverrides
                .Where(c => c.CarId == carId && (onlyNewSessions || c.IsManualOverride))
                .Select(c => c.ChargingProcessId)
                .ToListAsync())
                .ToHashSet();

            foreach (var session in sessions)
            {
                if (existingProcessIds.Contains(session.Id))
                    continue;

                decimal? pricePerKwh;
                decimal totalCost;

                if (location.PricingType == "subscription")
                {
                    totalCost = 0;
                    pricePerKwh = 0;
                }
                else
                {
                    pricePerKwh = CalculatePricePerKwh(location, session.StartDate);
                    var kwh = (decimal)(session.ChargeEnergyAdded ?? session.ChargeEnergyUsed ?? 0);
                    totalCost = (pricePerKwh ?? 0) * kwh;
                }

                var existing = await _db.ChargingCostOverrides
                    .FirstOrDefaultAsync(c => c.ChargingProcessId == session.Id && c.CarId == carId);

                if (existing != null)
                {
                    existing.PricePerKwh = pricePerKwh;
                    existing.TotalCost = totalCost;
                    existing.LocationId = location.Id;
                    existing.IsManualOverride = false;
                    existing.UpdatedAt = DateTime.UtcNow;
                }
                else
                {
                    _db.ChargingCostOverrides.Add(new ChargingCostOverride
                    {
                        ChargingProcessId = session.Id,
                        CarId = carId,
                        PricePerKwh = pricePerKwh,
                        TotalCost = totalCost,
                        IsFree = false,
                        IsManualOverride = false,
                        LocationId = location.Id
                    });
                }

                created++;
            }
        }

        await _db.SaveChangesAsync();
        return created;
    }

    private static bool IsOffPeak(ChargingLocation location, DateTime sessionStart)
    {
        if (location.OffPeakStart == null || location.OffPeakEnd == null)
            return false;

        var time = TimeOnly.FromDateTime(sessionStart);
        if (location.OffPeakStart <= location.OffPeakEnd)
            return time >= location.OffPeakStart && time < location.OffPeakEnd;

        return time >= location.OffPeakStart || time < location.OffPeakEnd;
    }

    private static double HaversineMeters(double lat1, double lon1, double lat2, double lon2)
    {
        const double R = 6371000;
        var dLat = ToRad(lat2 - lat1);
        var dLon = ToRad(lon2 - lon1);
        var a = Math.Sin(dLat / 2) * Math.Sin(dLat / 2) +
                Math.Cos(ToRad(lat1)) * Math.Cos(ToRad(lat2)) *
                Math.Sin(dLon / 2) * Math.Sin(dLon / 2);
        return R * 2 * Math.Atan2(Math.Sqrt(a), Math.Sqrt(1 - a));
    }

    private static double ToRad(double deg) => deg * Math.PI / 180.0;
}
