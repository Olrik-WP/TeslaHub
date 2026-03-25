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

    public async Task<CostSummaryDto> GetMonthlySummary(int carId, int year, int month, double totalDistanceKm)
    {
        var monthStart = new DateTime(year, month, 1, 0, 0, 0, DateTimeKind.Utc);
        var monthEnd = monthStart.AddMonths(1);

        var overrides = await _db.ChargingCostOverrides
            .Include(c => c.Location)
            .Where(c => c.CarId == carId && c.CreatedAt >= monthStart && c.CreatedAt < monthEnd)
            .ToListAsync();

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
            Period = $"{year}-{month:D2}",
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

        return lastOverride?.PricePerKwh;
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
