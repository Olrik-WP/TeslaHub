using Microsoft.EntityFrameworkCore;
using TeslaHub.Api.Data;
using TeslaHub.Api.Models;
using TeslaHub.Api.Services;
using TeslaHub.Api.TeslaMate;

namespace TeslaHub.Api.Endpoints;

/// <summary>
/// REST surface for the load-shedding feature exposed to the React SPA.
/// Read-mostly: one GET that aggregates all vehicles + the live MQTT
/// snapshot for the panel header, one PUT to upsert a profile, one DELETE
/// to remove it, and a paginated GET on the audit log.
///
/// Live status is intentionally short-poll (3 s refetch from the panel
/// via TanStack Query) instead of SSE: keeps the auth path identical to
/// the rest of the app (Bearer header) and avoids extending the
/// /api/vehicle/{id}/live-stream query-token hack to a second route.
/// </summary>
public static class LoadSheddingEndpoints
{
    public static void MapLoadSheddingEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/load-shedding").RequireAuthorization();

        group.MapGet("/status", async (
            AppDbContext db,
            HousePowerSource housePower,
            LoadSheddingEngine engine,
            MqttLiveDataService liveData,
            TeslaMateConnectionFactory tm,
            CancellationToken ct) =>
        {
            // Multi-account installs: the same VIN can appear twice in
            // TeslaVehicles when both spouses' Tesla accounts share the
            // car (one row per account, by design — the pairing wizard
            // needs both rows because each account must pair its own
            // virtual key). For load shedding only ONE entry per
            // physical car makes sense — otherwise we'd risk firing
            // set_charging_amps from two different accounts onto the
            // same VIN. We also filter to KeyPaired=true since unpaired
            // vehicles cannot accept signed commands anyway.
            var profiles = await db.LoadSheddingProfiles.ToListAsync(ct);
            var profileVehicleIds = profiles.Select(p => p.TeslaVehicleId).ToHashSet();

            var allRows = await db.TeslaVehicles
                .Where(v => v.KeyPaired)
                .Select(v => new { v.Id, v.Vin, v.DisplayName })
                .ToListAsync(ct);

            // Dedup by VIN. Prefer the row that already has a profile
            // attached, so editing an existing profile keeps working
            // even if the multi-account row order shifts on resync.
            var vehicles = allRows
                .GroupBy(v => v.Vin)
                .Select(g => g.OrderByDescending(v => profileVehicleIds.Contains(v.Id)).First())
                .OrderBy(v => v.DisplayName ?? v.Vin)
                .ToList();

            var profileByVehicle = profiles.ToDictionary(p => p.TeslaVehicleId);

            var firstProfile = profiles.FirstOrDefault();
            var latest = housePower.Latest;

            // The MQTT live cache (MqttLiveDataService) is keyed by the
            // TeslaMate `cars.id`, NOT by TeslaHub's TeslaVehicle.Id —
            // the former comes from the topic path `teslamate/cars/{id}/...`
            // and is unrelated to our Fleet API row id. Build a quick
            // VIN → TeslaMate carId map so we can fetch live data for a
            // dedup'd vehicle even when TeslaMate's id ≠ TeslaHub's id.
            var tmCars = (await tm.GetCarsAsync()).ToList();
            var tmCarIdByVin = tmCars
                .Where(c => !string.IsNullOrWhiteSpace(c.Vin))
                .GroupBy(c => c.Vin!)
                .ToDictionary(g => g.Key, g => g.First().Id, StringComparer.OrdinalIgnoreCase);

            var dto = new LoadSheddingStatusDto
            {
                MqttConnected = housePower.MqttConnected,
                // Mirror the topic the consumer is actually subscribed to
                // (defaults applied when no profile exists yet) so the UI
                // and the engine never disagree about what's being read.
                MqttTopic = firstProfile?.MqttTopic ?? "zigbee2mqtt/Lixee",
                House = new LoadSheddingHouseDto
                {
                    CurrentVa = latest?.Va,
                    LastSampleAt = latest?.At,
                    SamplesInLast60s = housePower.RecentSampleCount(TimeSpan.FromSeconds(60)),
                    // Echo the unit of the first profile so the SPA can
                    // suffix all values consistently. ZLinky default if
                    // none is configured yet.
                    Unit = string.IsNullOrWhiteSpace(firstProfile?.PowerUnit) ? "VA" : firstProfile.PowerUnit,
                },
                Vehicles = vehicles.Select(v =>
                {
                    profileByVehicle.TryGetValue(v.Id, out var profile);
                    var state = engine.States.TryGetValue(v.Id, out var s) ? s : null;
                    var live = tmCarIdByVin.TryGetValue(v.Vin, out var tmCarId)
                        ? liveData.GetLiveData(tmCarId)
                        : null;

                    int? teslaVa = null;
                    if (live?.ChargerVoltage is int volt && live.ChargerActualCurrent is double amp)
                        teslaVa = (int)Math.Round(volt * amp);

                    return new LoadSheddingVehicleDto
                    {
                        VehicleId = v.Id,
                        Vin = v.Vin,
                        DisplayName = v.DisplayName,
                        Profile = profile is null ? null : ToDto(profile),
                        Runtime = new LoadSheddingRuntimeDto
                        {
                            State = state?.Phase ?? (live is null ? "Unknown" : "Steady"),
                            ChargingState = live?.ChargingState,
                            CurrentAmps = live?.ChargerActualCurrent is double a ? (int)Math.Round(a) : null,
                            TeslaVa = teslaVa,
                            LastCommandAt = state?.LastCommandAt?.UtcDateTime,
                            CommandsLastHour = state?.CountWithin(TimeSpan.FromHours(1)) ?? 0,
                            CommandsLastDay = state?.CountWithin(TimeSpan.FromDays(1)) ?? 0,
                        },
                    };
                }).ToArray(),
            };

            return Results.Ok(dto);
        });

        group.MapPut("/profiles/{vehicleId:int}", async (
            int vehicleId,
            LoadSheddingProfileUpsertRequest body,
            AppDbContext db,
            LoadSheddingMqttSignal mqttSignal,
            CancellationToken ct) =>
        {
            var vehicleExists = await db.TeslaVehicles.AnyAsync(v => v.Id == vehicleId, ct);
            if (!vehicleExists) return Results.NotFound(new { error = "Vehicle not found." });

            // Defensive clamping: the SPA validates input but a curl
            // user could still post 200 A, which the proxy would
            // forward to Tesla and the car would reject with no
            // explanation. Better to fail fast here.
            body.MaxAmps = Math.Clamp(body.MaxAmps, 1, 80);
            body.MinAmps = Math.Clamp(body.MinAmps, 1, body.MaxAmps);
            body.TargetReducedAmps = Math.Clamp(body.TargetReducedAmps, body.MinAmps, body.MaxAmps);
            body.HighThresholdVa = Math.Max(0, body.HighThresholdVa);
            body.LowThresholdVa = Math.Clamp(body.LowThresholdVa, 0, body.HighThresholdVa);
            body.HighWindowSeconds = Math.Max(1, body.HighWindowSeconds);
            body.LowWindowSeconds = Math.Max(1, body.LowWindowSeconds);
            body.CooldownSeconds = Math.Max(0, body.CooldownSeconds);
            body.MinAmpsDelta = Math.Max(1, body.MinAmpsDelta);
            body.HourlyCommandQuota = Math.Max(1, body.HourlyCommandQuota);
            body.DailyCommandQuota = Math.Max(1, body.DailyCommandQuota);
            body.MinSamplesInWindow = Math.Max(1, body.MinSamplesInWindow);

            var profile = await db.LoadSheddingProfiles
                .FirstOrDefaultAsync(p => p.TeslaVehicleId == vehicleId, ct);

            if (profile is null)
            {
                profile = new LoadSheddingProfile
                {
                    TeslaVehicleId = vehicleId,
                    CreatedAt = DateTime.UtcNow,
                };
                db.LoadSheddingProfiles.Add(profile);
            }

            profile.Enabled = body.Enabled;
            profile.DryRun = body.DryRun;
            profile.MaxAmps = body.MaxAmps;
            profile.MinAmps = body.MinAmps;
            profile.TargetReducedAmps = body.TargetReducedAmps;
            profile.HighThresholdVa = body.HighThresholdVa;
            profile.LowThresholdVa = body.LowThresholdVa;
            profile.HighWindowSeconds = body.HighWindowSeconds;
            profile.LowWindowSeconds = body.LowWindowSeconds;
            profile.CooldownSeconds = body.CooldownSeconds;
            profile.MinAmpsDelta = body.MinAmpsDelta;
            profile.HourlyCommandQuota = body.HourlyCommandQuota;
            profile.DailyCommandQuota = body.DailyCommandQuota;
            profile.MinSamplesInWindow = body.MinSamplesInWindow;
            // Preserve the user's intent verbatim (trim only). An empty
            // PowerJsonField is a deliberate, valid value: it tells the
            // consumer the payload is a scalar at the root (e.g. P1 Reader,
            // Shelly EM Gen1 .../emeter/0/power, IoTaWatt). If we silently
            // substituted "apparent_power" here, the saved profile would
            // never match any preset that publishes a root scalar — the
            // SPA's preset dropdown would forever fall back to "Custom"
            // after the first save. Defaults are applied where they
            // belong: the consumer falls back when no profile exists at
            // all (LoadSheddingMqttConsumer.ResolveSourceAsync) and the
            // DTO falls back for display when the stored value is blank
            // (ToDto below). MqttTopic is required: an empty string would
            // make MQTTnet's subscribe call meaningless, so we reject it.
            var newTopic = (body.MqttTopic ?? string.Empty).Trim();
            if (string.IsNullOrEmpty(newTopic))
                return Results.BadRequest(new { error = "MqttTopic is required." });
            var newField = (body.PowerJsonField ?? string.Empty).Trim();
            var newUnit = (body.PowerUnit ?? string.Empty).Trim();
            var newScale = body.PowerScale <= 0 ? 1.0 : body.PowerScale;
            var sourceChanged = profile.MqttTopic != newTopic
                || profile.PowerJsonField != newField
                || Math.Abs(profile.PowerScale - newScale) > 0.0001;
            profile.MqttTopic = newTopic;
            profile.PowerJsonField = newField;
            profile.PowerUnit = newUnit;
            profile.PowerScale = newScale;
            profile.UpdatedAt = DateTime.UtcNow;

            await db.SaveChangesAsync(ct);

            // Topic / JSON field changes: ask the MQTT consumer to drop
            // its current subscription and re-resolve from DB. Without
            // this the user would have to restart teslahub-api after
            // every source edit.
            if (sourceChanged) mqttSignal.RequestRefresh();

            return Results.Ok(ToDto(profile));
        });

        group.MapDelete("/profiles/{vehicleId:int}", async (
            int vehicleId,
            AppDbContext db,
            CancellationToken ct) =>
        {
            var profile = await db.LoadSheddingProfiles
                .FirstOrDefaultAsync(p => p.TeslaVehicleId == vehicleId, ct);
            if (profile is null) return Results.NoContent();

            db.LoadSheddingProfiles.Remove(profile);
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        });

        group.MapGet("/events", async (
            AppDbContext db,
            int? vehicleId,
            int? take,
            CancellationToken ct) =>
        {
            var query = db.LoadSheddingEvents.AsQueryable();
            if (vehicleId is int vid) query = query.Where(e => e.TeslaVehicleId == vid);

            var rows = await query
                .OrderByDescending(e => e.At)
                .Take(Math.Clamp(take ?? 50, 1, 200))
                .Select(e => new LoadSheddingEventDto
                {
                    Id = e.Id,
                    TeslaVehicleId = e.TeslaVehicleId,
                    At = e.At,
                    Kind = e.Kind,
                    FromAmps = e.FromAmps,
                    ToAmps = e.ToAmps,
                    HouseVa = e.HouseVa,
                    Detail = e.Detail,
                })
                .ToListAsync(ct);

            return Results.Ok(rows);
        });
    }

    private static LoadSheddingProfileDto ToDto(LoadSheddingProfile p) => new()
    {
        Id = p.Id,
        Enabled = p.Enabled,
        DryRun = p.DryRun,
        MaxAmps = p.MaxAmps,
        MinAmps = p.MinAmps,
        TargetReducedAmps = p.TargetReducedAmps,
        HighThresholdVa = p.HighThresholdVa,
        LowThresholdVa = p.LowThresholdVa,
        HighWindowSeconds = p.HighWindowSeconds,
        LowWindowSeconds = p.LowWindowSeconds,
        CooldownSeconds = p.CooldownSeconds,
        MinAmpsDelta = p.MinAmpsDelta,
        HourlyCommandQuota = p.HourlyCommandQuota,
        DailyCommandQuota = p.DailyCommandQuota,
        MinSamplesInWindow = p.MinSamplesInWindow,
        MqttTopic = p.MqttTopic,
        PowerJsonField = p.PowerJsonField,
        PowerUnit = string.IsNullOrWhiteSpace(p.PowerUnit) ? "VA" : p.PowerUnit,
        PowerScale = p.PowerScale <= 0 ? 1.0 : p.PowerScale,
    };
}
