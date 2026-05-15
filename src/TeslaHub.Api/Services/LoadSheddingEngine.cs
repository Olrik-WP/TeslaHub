using System.Collections.Concurrent;
using Microsoft.EntityFrameworkCore;
using TeslaHub.Api.Data;
using TeslaHub.Api.Models;
using TeslaHub.Api.TeslaMate;

namespace TeslaHub.Api.Services;

/// <summary>
/// Periodic decision loop. Every <see cref="TickInterval"/> the engine
///
///   1. loads enabled profiles from the DB,
///   2. asks <see cref="MqttLiveDataService"/> for the live charging
///      state + actual amps of the matching vehicle,
///   3. asks <see cref="ILoadSheddingPolicy"/> for a decision,
///   4. applies guard-rails (cooldown, hourly/daily quotas, min-delta),
///   5. either calls <see cref="TeslaCommandService"/> with
///      <c>set_charging_amps</c> or just writes a dry-run event.
///
/// All command attempts (success, failure, skip, quota-hit) write a
/// <see cref="LoadSheddingEvent"/> row so the Settings UI can render an
/// audit timeline without grepping logs.
///
/// The engine never wakes a sleeping vehicle: if the car is not
/// actively charging there is nothing to throttle, and waking it up
/// would only burn Fleet API quota for no benefit.
/// </summary>
public sealed class LoadSheddingEngine : BackgroundService
{
    private static readonly TimeSpan TickInterval = TimeSpan.FromSeconds(5);

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly HousePowerSource _housePower;
    private readonly MqttLiveDataService _liveData;
    private readonly ILoadSheddingPolicy _policy;
    private readonly ILogger<LoadSheddingEngine> _logger;

    private readonly ConcurrentDictionary<int, VehicleSheddingState> _states = new();

    // Cached VIN → TeslaMate cars.id map (refreshed every 60 s). The
    // MQTT live cache (MqttLiveDataService) is keyed by TeslaMate's id
    // which is unrelated to TeslaHub's TeslaVehicle.Id; the VIN is the
    // only stable bridge between both worlds.
    private Dictionary<string, int> _tmCarIdByVin = new(StringComparer.OrdinalIgnoreCase);
    private DateTimeOffset _tmCarIdMapAt = DateTimeOffset.MinValue;
    private static readonly TimeSpan TmCarMapTtl = TimeSpan.FromSeconds(60);

    public LoadSheddingEngine(
        IServiceScopeFactory scopeFactory,
        HousePowerSource housePower,
        MqttLiveDataService liveData,
        ILoadSheddingPolicy policy,
        ILogger<LoadSheddingEngine> logger)
    {
        _scopeFactory = scopeFactory;
        _housePower = housePower;
        _liveData = liveData;
        _policy = policy;
        _logger = logger;
    }

    /// <summary>Read-only view exposed to the API endpoint for the live UI snapshot.</summary>
    public IReadOnlyDictionary<int, VehicleSheddingState> States => _states;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Same 5 s startup delay as the MQTT consumer: gives Migrate()
        // time to finish before we issue the first DB query.
        try { await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken); }
        catch (OperationCanceledException) { return; }

        _logger.LogInformation("Load-shedding engine started (tick {Tick}).", TickInterval);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await TickAsync(stoppingToken);
            }
            catch (OperationCanceledException) { break; }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Load-shedding engine tick failed; will retry next interval.");
            }

            try { await Task.Delay(TickInterval, stoppingToken); }
            catch (OperationCanceledException) { break; }
        }
    }

    private async Task TickAsync(CancellationToken cancellationToken)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var commands = scope.ServiceProvider.GetRequiredService<TeslaCommandService>();
        var tm = scope.ServiceProvider.GetRequiredService<TeslaMateConnectionFactory>();

        // Pull (and cache) the VIN ↔ TeslaMate carId mapping. Without it
        // we cannot read live ChargingState / ChargerActualCurrent for
        // the right car when the install has multiple Tesla accounts.
        if (DateTimeOffset.UtcNow - _tmCarIdMapAt > TmCarMapTtl)
        {
            try
            {
                var tmCars = await tm.GetCarsAsync();
                _tmCarIdByVin = tmCars
                    .Where(c => !string.IsNullOrWhiteSpace(c.Vin))
                    .GroupBy(c => c.Vin!)
                    .ToDictionary(g => g.Key, g => g.First().Id, StringComparer.OrdinalIgnoreCase);
                _tmCarIdMapAt = DateTimeOffset.UtcNow;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to refresh TeslaMate VIN→carId map; engine will retry next tick.");
            }
        }

        // Join profiles with their TeslaVehicle to get the VIN. We need
        // the VIN to look up the TeslaMate carId for live data, while
        // commands still flow through the TeslaHub TeslaVehicle.Id (the
        // Fleet API path).
        var profiles = await db.LoadSheddingProfiles
            .Where(p => p.Enabled)
            .Include(p => p.TeslaVehicle)
            .ToListAsync(cancellationToken);

        foreach (var profile in profiles)
        {
            var state = _states.GetOrAdd(profile.TeslaVehicleId, _ => new VehicleSheddingState());
            state.TrimQuotaWindows();

            var vin = profile.TeslaVehicle?.Vin;
            MqttLiveData? live = null;
            if (!string.IsNullOrWhiteSpace(vin) && _tmCarIdByVin.TryGetValue(vin, out var tmCarId))
                live = _liveData.GetLiveData(tmCarId);
            if (live is null
                || !string.Equals(live.ChargingState, "Charging", StringComparison.OrdinalIgnoreCase))
            {
                if (state.Phase != "Steady")
                {
                    state.Phase = "Steady";
                    state.LastAppliedAmps = null;
                }
                continue;
            }

            var observedAmps = (int)Math.Round(live.ChargerActualCurrent ?? profile.MaxAmps);
            var decision = _policy.Decide(profile, state, _housePower, observedAmps);

            if (decision.Kind is LoadSheddingDecisionKind.Hold or LoadSheddingDecisionKind.NoData)
                continue;

            if (state.CooldownUntil is { } until && DateTimeOffset.UtcNow < until)
            {
                // Cooldown active — explicit log so the timeline shows why.
                await WriteEventAsync(db, profile.TeslaVehicleId, "Skip",
                    observedAmps, decision.TargetAmps,
                    $"Cooldown until {until:O}", cancellationToken);
                continue;
            }

            if (state.CountWithin(TimeSpan.FromHours(1)) >= profile.HourlyCommandQuota)
            {
                await WriteEventAsync(db, profile.TeslaVehicleId, "QuotaHit",
                    observedAmps, decision.TargetAmps,
                    $"Hourly quota {profile.HourlyCommandQuota} exhausted", cancellationToken);
                continue;
            }

            if (state.CountWithin(TimeSpan.FromDays(1)) >= profile.DailyCommandQuota)
            {
                await WriteEventAsync(db, profile.TeslaVehicleId, "QuotaHit",
                    observedAmps, decision.TargetAmps,
                    $"Daily quota {profile.DailyCommandQuota} exhausted", cancellationToken);
                continue;
            }

            if (Math.Abs(decision.TargetAmps!.Value - observedAmps) < profile.MinAmpsDelta)
            {
                await WriteEventAsync(db, profile.TeslaVehicleId, "Skip",
                    observedAmps, decision.TargetAmps,
                    $"|Δ| < MinAmpsDelta ({profile.MinAmpsDelta})", cancellationToken);
                continue;
            }

            // Cooldown is started even on dry-run, so the dry-run timeline
            // is at the same cadence as the real one — otherwise the user
            // sees a misleadingly chatty audit during testing.
            state.CooldownUntil = DateTimeOffset.UtcNow + TimeSpan.FromSeconds(profile.CooldownSeconds);
            state.LastCommandAt = DateTimeOffset.UtcNow;
            state.RecentCommandTimes.Enqueue(DateTimeOffset.UtcNow);

            var clampedTarget = Math.Clamp(decision.TargetAmps.Value, profile.MinAmps, profile.MaxAmps);

            if (profile.DryRun)
            {
                state.Phase = decision.Kind == LoadSheddingDecisionKind.Reduce ? "Reduced" : "Steady";
                state.LastAppliedAmps = clampedTarget;
                await WriteEventAsync(db, profile.TeslaVehicleId,
                    decision.Kind == LoadSheddingDecisionKind.Reduce ? "DryRunReduce" : "DryRunRaise",
                    observedAmps, clampedTarget,
                    decision.Reason, cancellationToken);
                continue;
            }

            var result = await commands.SendSignedCommandAsync(
                profile.TeslaVehicleId,
                "set_charging_amps",
                new { charging_amps = clampedTarget },
                cancellationToken);

            if (result.Success)
            {
                state.Phase = decision.Kind == LoadSheddingDecisionKind.Reduce ? "Reduced" : "Steady";
                state.LastAppliedAmps = clampedTarget;
                await WriteEventAsync(db, profile.TeslaVehicleId,
                    decision.Kind == LoadSheddingDecisionKind.Reduce ? "Reduce" : "Raise",
                    observedAmps, clampedTarget,
                    decision.Reason, cancellationToken);
            }
            else
            {
                // Tesla rate limit → push the cooldown out so we don't burn
                // through more Fleet calls until the limiter window resets.
                if (result.FailureKind == CommandFailureKind.RateLimited)
                    state.CooldownUntil = DateTimeOffset.UtcNow + TimeSpan.FromSeconds(profile.CooldownSeconds * 4);

                await WriteEventAsync(db, profile.TeslaVehicleId, "ProxyError",
                    observedAmps, clampedTarget,
                    $"{result.FailureKind}: {result.Error}", cancellationToken);
            }
        }
    }

    private async Task WriteEventAsync(
        AppDbContext db, int vehicleId, string kind, int? from, int? to, string? detail,
        CancellationToken cancellationToken)
    {
        try
        {
            db.LoadSheddingEvents.Add(new LoadSheddingEvent
            {
                TeslaVehicleId = vehicleId,
                At = DateTime.UtcNow,
                Kind = kind,
                FromAmps = from,
                ToAmps = to,
                HouseVa = _housePower.Latest?.Va,
                Detail = detail,
            });
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to persist LoadSheddingEvent ({Kind}) for vehicle {VehicleId}", kind, vehicleId);
        }
    }
}
