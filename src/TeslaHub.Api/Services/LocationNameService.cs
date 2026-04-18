using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using TeslaHub.Api.Data;
using TeslaHub.Api.Models;
using TeslaHub.Api.Utilities;

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
            entry.Size = 1;
            return await _db.ChargingLocations.AsNoTracking().ToListAsync();
        }) ?? [];
    }

    public string? FindName(List<ChargingLocation> locations, double? lat, double? lng, int? carId = null)
    {
        if (lat == null || lng == null) return null;

        foreach (var loc in locations)
        {
            if (carId != null && loc.CarId != null && loc.CarId != carId) continue;
            if (GeoDistance.HaversineMeters(lat.Value, lng.Value, loc.Latitude, loc.Longitude) <= loc.RadiusMeters)
                return loc.Name;
        }
        return null;
    }
}
