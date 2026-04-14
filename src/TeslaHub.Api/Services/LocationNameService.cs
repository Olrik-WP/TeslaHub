using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using TeslaHub.Api.Data;
using TeslaHub.Api.Models;

namespace TeslaHub.Api.Services;

public class LocationNameService
{
    private readonly AppDbContext _db;
    private readonly IMemoryCache _cache;
    private const string CacheKey = "teslahub:locations";

    public LocationNameService(AppDbContext db, IMemoryCache cache)
    {
        _db = db;
        _cache = cache;
    }

    public async Task<List<ChargingLocation>> GetLocationsAsync()
    {
        return await _cache.GetOrCreateAsync(CacheKey, async entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(5);
            return await _db.ChargingLocations.AsNoTracking().ToListAsync();
        }) ?? [];
    }

    public string? FindName(List<ChargingLocation> locations, double? lat, double? lng, int? carId = null)
    {
        if (lat == null || lng == null) return null;

        foreach (var loc in locations)
        {
            if (carId != null && loc.CarId != null && loc.CarId != carId) continue;
            if (HaversineMeters(lat.Value, lng.Value, loc.Latitude, loc.Longitude) <= loc.RadiusMeters)
                return loc.Name;
        }
        return null;
    }

    private static double HaversineMeters(double lat1, double lon1, double lat2, double lon2)
    {
        const double R = 6371000;
        var dLat = (lat2 - lat1) * Math.PI / 180.0;
        var dLon = (lon2 - lon1) * Math.PI / 180.0;
        var a = Math.Sin(dLat / 2) * Math.Sin(dLat / 2) +
                Math.Cos(lat1 * Math.PI / 180.0) * Math.Cos(lat2 * Math.PI / 180.0) *
                Math.Sin(dLon / 2) * Math.Sin(dLon / 2);
        return R * 2 * Math.Atan2(Math.Sqrt(a), Math.Sqrt(1 - a));
    }
}
