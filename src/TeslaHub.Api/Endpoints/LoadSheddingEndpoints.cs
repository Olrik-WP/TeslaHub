using Microsoft.EntityFrameworkCore;
using TeslaHub.Api.Data;
using TeslaHub.Api.Models;
using TeslaHub.Api.Services;

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
            CancellationToken ct) =>
        {
            var vehicles = await db.TeslaVehicles
                .OrderBy(v => v.DisplayName ?? v.Vin)
                .Select(v => new { v.Id, v.Vin, v.DisplayName })
                .ToListAsync(ct);

            var profiles = await db.LoadSheddingProfiles.ToListAsync(ct);
            var profileByVehicle = profiles.ToDictionary(p => p.TeslaVehicleId);

            var firstProfile = profiles.FirstOrDefault();
            var latest = housePower.Latest;

            var dto = new LoadSheddingStatusDto
            {
                MqttConnected = housePower.MqttConnected,
                MqttTopic = firstProfile?.MqttTopic,
                House = new LoadSheddingHouseDto
                {
                    CurrentVa = latest?.Va,
                    LastSampleAt = latest?.At,
                    SamplesInLast60s = housePower.RecentSampleCount(TimeSpan.FromSeconds(60)),
                },
                Vehicles = vehicles.Select(v =>
                {
                    profileByVehicle.TryGetValue(v.Id, out var profile);
                    var state = engine.States.TryGetValue(v.Id, out var s) ? s : null;
                    var live = liveData.GetLiveData(v.Id);

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
            profile.MqttTopic = string.IsNullOrWhiteSpace(body.MqttTopic) ? "zigbee2mqtt/Lixee" : body.MqttTopic.Trim();
            profile.PowerJsonField = string.IsNullOrWhiteSpace(body.PowerJsonField) ? "apparent_power" : body.PowerJsonField.Trim();
            profile.UpdatedAt = DateTime.UtcNow;

            await db.SaveChangesAsync(ct);
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
    };
}
