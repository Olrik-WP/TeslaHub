using Microsoft.Extensions.Caching.Memory;

namespace TeslaHub.Api.Services;

public class CacheService
{
    private readonly IMemoryCache _cache;

    private static readonly TimeSpan LiveDataTtl = TimeSpan.FromSeconds(30);
    private static readonly TimeSpan HistoricalDataTtl = TimeSpan.FromMinutes(5);
    private static readonly TimeSpan StaticDataTtl = TimeSpan.FromMinutes(30);

    public CacheService(IMemoryCache cache)
    {
        _cache = cache;
    }

    public async Task<T> GetOrSetLiveAsync<T>(string key, Func<Task<T>> factory)
    {
        return await GetOrSetAsync(key, factory, LiveDataTtl);
    }

    public async Task<T> GetOrSetHistoricalAsync<T>(string key, Func<Task<T>> factory)
    {
        return await GetOrSetAsync(key, factory, HistoricalDataTtl);
    }

    public async Task<T> GetOrSetStaticAsync<T>(string key, Func<Task<T>> factory)
    {
        return await GetOrSetAsync(key, factory, StaticDataTtl);
    }

    public void Invalidate(string key)
    {
        _cache.Remove(key);
    }

    public void InvalidateByPrefix(string prefix)
    {
        if (_cache is MemoryCache mc)
        {
            mc.Compact(0);
        }
    }

    private async Task<T> GetOrSetAsync<T>(string key, Func<Task<T>> factory, TimeSpan ttl)
    {
        if (_cache.TryGetValue(key, out T? cached) && cached != null)
            return cached;

        var value = await factory();

        _cache.Set(key, value, new MemoryCacheEntryOptions
        {
            AbsoluteExpirationRelativeToNow = ttl,
            Size = 1
        });

        return value;
    }
}
