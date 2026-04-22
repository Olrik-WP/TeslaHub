using System.Collections.Concurrent;
using Microsoft.EntityFrameworkCore;
using TeslaHub.Api.Data;
using TeslaHub.Api.Models;

namespace TeslaHub.Api.Services;

/// <summary>
/// Counts every billable Tesla Fleet API request emitted by TeslaHub
/// and persists the totals per (year-month, pricing category) so the
/// Settings page can show an estimated monthly bill.
///
/// Why estimated? Tesla does not expose a "current cost" endpoint. The
/// only authoritative source is https://developer.tesla.com/dashboard/usage.
/// Per Tesla billing rules:
///   * requests with HTTP status &lt; 500 are billable;
///   * requests with status &gt;= 500 are NOT billed.
/// We honour both rules. The categoriser lives in
/// <see cref="FleetApiUsageHandler"/> which inspects request URLs.
///
/// In-memory deltas are flushed to PostgreSQL roughly every 30 s by a
/// background loop, so a process crash loses at most a handful of
/// counts. Reads are always served from a fresh DB query so the value
/// the user sees in Settings matches what's persisted.
/// </summary>
public sealed class FleetApiUsageMeter : IHostedService, IDisposable
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<FleetApiUsageMeter> _logger;
    private readonly TimeSpan _flushInterval = TimeSpan.FromSeconds(30);

    // Pending deltas: key = "yyyy-MM|category".
    private readonly ConcurrentDictionary<string, long> _pending = new();
    private CancellationTokenSource? _cts;
    private Task? _loop;

    public FleetApiUsageMeter(IServiceScopeFactory scopeFactory, ILogger<FleetApiUsageMeter> logger)
    {
        _scopeFactory = scopeFactory;
        _logger = logger;
    }

    /// <summary>
    /// Records a single Fleet API request. Status &gt;= 500 is silently
    /// dropped because Tesla doesn't bill us for it. Partner endpoints
    /// are still recorded (their counter is shown for visibility) but
    /// don't add to the cost estimate.
    /// </summary>
    public void Record(FleetApiPricingCategory category, int statusCode)
    {
        if (statusCode >= 500) return;

        var key = BuildKey(DateTime.UtcNow, category);
        _pending.AddOrUpdate(key, 1, (_, current) => current + 1);
    }

    public Task StartAsync(CancellationToken cancellationToken)
    {
        _cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        _loop = Task.Run(() => FlushLoopAsync(_cts.Token));
        return Task.CompletedTask;
    }

    public async Task StopAsync(CancellationToken cancellationToken)
    {
        _cts?.Cancel();
        if (_loop is not null)
        {
            try { await _loop; } catch { /* best effort */ }
        }
        await FlushPendingAsync(CancellationToken.None);
    }

    private async Task FlushLoopAsync(CancellationToken token)
    {
        while (!token.IsCancellationRequested)
        {
            try
            {
                await Task.Delay(_flushInterval, token);
            }
            catch (TaskCanceledException) { break; }

            try { await FlushPendingAsync(token); }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "FleetApiUsageMeter flush failed; will retry.");
            }
        }
    }

    private async Task FlushPendingAsync(CancellationToken token)
    {
        if (_pending.IsEmpty) return;

        // Snapshot + clear so concurrent recordings don't race the flush.
        var snapshot = new Dictionary<string, long>();
        foreach (var key in _pending.Keys.ToArray())
        {
            if (_pending.TryRemove(key, out var value) && value > 0)
                snapshot[key] = value;
        }
        if (snapshot.Count == 0) return;

        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        foreach (var (key, count) in snapshot)
        {
            var (yearMonth, category) = ParseKey(key);

            var row = await db.FleetApiUsages
                .FirstOrDefaultAsync(r => r.YearMonth == yearMonth && r.Category == category, token);

            if (row is null)
            {
                row = new FleetApiUsage
                {
                    YearMonth = yearMonth,
                    Category = category,
                    RequestCount = count,
                    UpdatedAt = DateTime.UtcNow,
                };
                db.FleetApiUsages.Add(row);
            }
            else
            {
                row.RequestCount += count;
                row.UpdatedAt = DateTime.UtcNow;
            }
        }

        try { await db.SaveChangesAsync(token); }
        catch (Exception ex)
        {
            // Re-queue counts so a transient DB outage doesn't lose data.
            foreach (var (key, count) in snapshot)
                _pending.AddOrUpdate(key, count, (_, current) => current + count);
            _logger.LogWarning(ex, "FleetApiUsageMeter could not persist {Count} buckets; re-queued.", snapshot.Count);
        }
    }

    /// <summary>Compute the per-category totals + USD subtotals for the given month.</summary>
    public static FleetApiUsageCategoryDto[] BuildCategoryDtos(IEnumerable<FleetApiUsage> rows)
    {
        // Always emit one row per known category (even count=0) so the
        // UI can render a stable table without conditional cells.
        var byCategory = rows.ToDictionary(r => r.Category, r => r.RequestCount);

        FleetApiPricingCategory[] visible =
        {
            FleetApiPricingCategory.WakeUp,
            FleetApiPricingCategory.VehicleData,
            FleetApiPricingCategory.VehicleCommands,
        };

        return visible.Select(cat =>
        {
            var count = byCategory.TryGetValue(cat, out var c) ? c : 0L;
            var unit = FleetApiPricing.UnitPrice(cat);
            return new FleetApiUsageCategoryDto
            {
                Category = cat.ToString(),
                RequestCount = count,
                UnitPriceUsd = unit,
                SubtotalUsd = decimal.Round(count * unit, 4, MidpointRounding.AwayFromZero),
            };
        }).ToArray();
    }

    /// <summary>Convenience helper used by the HTTP endpoint.</summary>
    public async Task<FleetApiUsageDto> GetSnapshotAsync(AppDbContext db, bool enabled, CancellationToken token)
    {
        // Flush any pending deltas first so the snapshot reflects every
        // request the user just made (otherwise a freshly tapped button
        // wouldn't appear until the next 30 s tick).
        await FlushPendingAsync(token);

        var now = DateTime.UtcNow;
        var thisMonth = now.ToString("yyyy-MM");
        var prevMonth = now.AddMonths(-1).ToString("yyyy-MM");

        var rows = await db.FleetApiUsages
            .Where(r => r.YearMonth == thisMonth || r.YearMonth == prevMonth)
            .ToListAsync(token);

        var thisRows = rows.Where(r => r.YearMonth == thisMonth).ToArray();
        var prevRows = rows.Where(r => r.YearMonth == prevMonth).ToArray();

        var thisCats = BuildCategoryDtos(thisRows);
        var gross = thisCats.Sum(c => c.SubtotalUsd);
        var credit = FleetApiPricing.MonthlyCreditUsd;
        var net = decimal.Round(Math.Max(0m, gross - credit), 2, MidpointRounding.AwayFromZero);

        FleetApiUsagePreviousMonthDto? previous = null;
        if (prevRows.Length > 0)
        {
            var prevCats = BuildCategoryDtos(prevRows);
            var prevGross = prevCats.Sum(c => c.SubtotalUsd);
            var prevNet = decimal.Round(Math.Max(0m, prevGross - credit), 2, MidpointRounding.AwayFromZero);
            previous = new FleetApiUsagePreviousMonthDto
            {
                YearMonth = prevMonth,
                GrossUsd = decimal.Round(prevGross, 2, MidpointRounding.AwayFromZero),
                NetUsd = prevNet,
            };
        }

        return new FleetApiUsageDto
        {
            Enabled = enabled,
            YearMonth = thisMonth,
            PeriodStartUtc = new DateTime(now.Year, now.Month, 1, 0, 0, 0, DateTimeKind.Utc),
            GeneratedAtUtc = now,
            Categories = thisCats,
            GrossUsd = decimal.Round(gross, 2, MidpointRounding.AwayFromZero),
            CreditUsd = credit,
            NetUsd = net,
            PreviousMonth = previous,
        };
    }

    public void Dispose()
    {
        _cts?.Cancel();
        _cts?.Dispose();
    }

    private static string BuildKey(DateTime utcNow, FleetApiPricingCategory category) =>
        $"{utcNow:yyyy-MM}|{(int)category}";

    private static (string YearMonth, FleetApiPricingCategory Category) ParseKey(string key)
    {
        var parts = key.Split('|', 2);
        return (parts[0], (FleetApiPricingCategory)int.Parse(parts[1]));
    }
}

/// <summary>
/// HTTP message handler attached to the named <c>tesla</c> and
/// <c>tesla-proxy</c> clients. Inspects the outgoing request URL,
/// classifies it under one of <see cref="FleetApiPricingCategory"/>
/// and records the response status into <see cref="FleetApiUsageMeter"/>.
///
/// We deliberately classify by URL pattern rather than by call-site:
/// keeping the rule in one place makes it obvious which endpoints are
/// billable, and prevents future regressions where a new caller forgets
/// to instrument itself.
/// </summary>
public sealed class FleetApiUsageHandler : DelegatingHandler
{
    private readonly FleetApiUsageMeter _meter;

    public FleetApiUsageHandler(FleetApiUsageMeter meter)
    {
        _meter = meter;
    }

    protected override async Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request,
        CancellationToken cancellationToken)
    {
        var response = await base.SendAsync(request, cancellationToken);

        try
        {
            var category = ClassifyRequest(request);
            if (category.HasValue)
                _meter.Record(category.Value, (int)response.StatusCode);
        }
        catch
        {
            // Never let metering disturb a real Fleet API call.
        }

        return response;
    }

    /// <summary>
    /// Maps the request to a Tesla pricing category. Returns null when
    /// the request isn't a Fleet API call we want to count
    /// (Open Charge Map, OAuth token endpoints, etc.).
    /// </summary>
    internal static FleetApiPricingCategory? ClassifyRequest(HttpRequestMessage request)
    {
        var path = request.RequestUri?.AbsolutePath;
        if (string.IsNullOrEmpty(path)) return null;

        // Bail out on anything outside the Fleet API surface.
        // /api/1/* covers the public Fleet API (and the local
        // tesla-http-proxy passthroughs share the same path).
        if (!path.Contains("/api/1/", StringComparison.Ordinal)) return null;

        // Order matters: more specific matches first.
        if (path.EndsWith("/wake_up", StringComparison.Ordinal))
            return FleetApiPricingCategory.WakeUp;

        if (path.Contains("/command/", StringComparison.Ordinal))
            return FleetApiPricingCategory.VehicleCommands;

        if (path.EndsWith("/fleet_telemetry_config", StringComparison.Ordinal)
            || path.EndsWith("/fleet_telemetry_config_create", StringComparison.Ordinal))
            return FleetApiPricingCategory.VehicleCommands;

        if (path.EndsWith("/vehicle_data", StringComparison.Ordinal))
            return FleetApiPricingCategory.VehicleData;

        // Per-vehicle summary GETs: /api/1/vehicles/{idOrVin} (no trailing path)
        // and the bare list /api/1/vehicles. Both are billed as Vehicle Data.
        if (path.EndsWith("/api/1/vehicles", StringComparison.Ordinal))
            return FleetApiPricingCategory.VehicleData;

        if (IsBareVehicleSummary(path))
            return FleetApiPricingCategory.VehicleData;

        if (path.Contains("/api/1/partner_accounts", StringComparison.Ordinal))
            return FleetApiPricingCategory.Partner;

        // Unknown Fleet API endpoints: don't guess a price, but log
        // nothing — we'd rather under-estimate than mis-classify.
        return null;
    }

    private static bool IsBareVehicleSummary(string path)
    {
        // Match /api/1/vehicles/<segment> with no further sub-path.
        const string prefix = "/api/1/vehicles/";
        var idx = path.IndexOf(prefix, StringComparison.Ordinal);
        if (idx < 0) return false;
        var rest = path[(idx + prefix.Length)..];
        // rest must be a single segment (no '/')
        return rest.Length > 0 && !rest.Contains('/');
    }
}
