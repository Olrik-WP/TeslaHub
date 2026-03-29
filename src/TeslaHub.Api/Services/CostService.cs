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

    public async Task<decimal?> CalculateSubscriptionCostForSession(
        ChargingLocation location, int carId, DateTime sessionStart)
    {
        if (location.PricingType != "subscription" || location.MonthlySubscription == null)
            return null;

        var monthStart = new DateTime(sessionStart.Year, sessionStart.Month, 1, 0, 0, 0, DateTimeKind.Utc);
        var monthEnd = monthStart.AddMonths(1);

        var sessionsThisMonth = await _db.ChargingCostOverrides
            .Where(c => c.LocationId == location.Id && c.CarId == carId
                && c.CreatedAt >= monthStart && c.CreatedAt < monthEnd)
            .CountAsync();

        var count = Math.Max(sessionsThisMonth, 1);
        return Math.Round(location.MonthlySubscription.Value / count, 2);
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

    public async Task<CostSummaryDto> GetSummary(int carId, string period, int year, int month, double totalDistanceKm)
    {
        var (start, end, label) = ComputeDateRange(period, year, month);

        var query = _db.ChargingCostOverrides
            .Include(c => c.Location)
            .Where(c => c.CarId == carId);

        if (start.HasValue)
            query = query.Where(c => c.CreatedAt >= start.Value);
        if (end.HasValue)
            query = query.Where(c => c.CreatedAt < end.Value);

        var overrides = await query.ToListAsync();

        var totalCost = overrides.Sum(c => c.TotalCost);
        var totalKwh = overrides
            .Where(c => c.PricePerKwh > 0 && !c.IsFree)
            .Sum(c => c.PricePerKwh > 0 ? c.TotalCost / c.PricePerKwh.Value : 0);
        var sessionCount = overrides.Count;
        var freeCount = overrides.Count(c => c.IsFree || c.TotalCost == 0);

        var costByLocation = overrides
            .GroupBy(c => c.Location?.Name ?? "Other")
            .ToDictionary(g => g.Key, g => g.Sum(c => c.TotalCost));

        return new CostSummaryDto
        {
            Period = label,
            TotalCost = totalCost,
            TotalKwh = totalKwh,
            AvgPricePerKwh = totalKwh > 0 ? Math.Round(totalCost / totalKwh, 4) : 0,
            CostPerKm = totalDistanceKm > 0 ? Math.Round(totalCost / (decimal)totalDistanceKm, 4) : 0,
            TotalDistanceKm = (decimal)totalDistanceKm,
            SessionCount = sessionCount,
            FreeSessionCount = freeCount,
            CostByLocation = costByLocation
        };
    }

    public static (DateTime? Start, DateTime? End, string Label) ComputeDateRange(string period, int year, int month)
    {
        return period switch
        {
            "year" => (
                new DateTime(year, 1, 1, 0, 0, 0, DateTimeKind.Utc),
                new DateTime(year + 1, 1, 1, 0, 0, 0, DateTimeKind.Utc),
                $"{year}"),
            "all" => (null, null, "All time"),
            _ => (
                new DateTime(year, month, 1, 0, 0, 0, DateTimeKind.Utc),
                new DateTime(year, month, 1, 0, 0, 0, DateTimeKind.Utc).AddMonths(1),
                $"{year}-{month:D2}")
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
    /// Auto-apply pricing for ALL saved locations that match a given car.
    /// Called on overrides load so new sessions always get priced automatically.
    /// </summary>
    public async Task<int> AutoApplyAllLocationsPricingAsync(int carId)
    {
        var locations = await _db.ChargingLocations
            .Where(l => l.CarId == null || l.CarId == carId)
            .Where(l => l.PricingType == "home" || l.PricingType == "subscription")
            .ToListAsync();

        var total = 0;
        foreach (var location in locations)
            total += await ApplyLocationPricingAsync(location);

        return total;
    }

    /// <summary>
    /// Auto-apply location pricing to all matching charging sessions that don't have a manual override.
    /// </summary>
    public async Task<int> ApplyLocationPricingAsync(ChargingLocation location)
    {
        var carIds = location.CarId.HasValue
            ? new[] { location.CarId.Value }
            : (await _tm.GetCarIdsAsync()).ToArray();

        var created = 0;

        foreach (var carId in carIds)
        {
            var sessions = await _tm.GetChargingSessionsForLocationAsync(
                carId, location.Latitude, location.Longitude, location.RadiusMeters);

            var existingProcessIds = (await _db.ChargingCostOverrides
                .Where(c => c.CarId == carId && c.IsManualOverride)
                .Select(c => c.ChargingProcessId)
                .ToListAsync())
                .ToHashSet();

            foreach (var session in sessions)
            {
                if (existingProcessIds.Contains(session.Id))
                    continue;

                var pricePerKwh = CalculatePricePerKwh(location, session.StartDate);
                decimal totalCost;

                if (location.PricingType == "subscription")
                {
                    var subCost = await CalculateSubscriptionCostForSession(location, carId, session.StartDate);
                    totalCost = subCost ?? 0;
                    pricePerKwh = session.ChargeEnergyAdded > 0
                        ? Math.Round(totalCost / (decimal)session.ChargeEnergyAdded.Value, 4)
                        : null;
                }
                else
                {
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
