using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using TeslaHub.Api.Data;
using TeslaHub.Api.Models;
using TeslaHub.Api.Services;

namespace TeslaHub.Api.Endpoints;

/// <summary>
/// Endpoints powering the "Control" page (one-tap remote operations on a
/// paired Tesla via Fleet API). Every command goes through
/// <see cref="TeslaCommandService"/> which:
///   * routes signed commands through the local tesla-http-proxy,
///   * routes the few <c>ErrCommandUseRESTAPI</c> cases (share, valet PIN
///     legacy, …) straight to fleet-api.prd.<region>,
///   * calls <c>wake_up</c> on demand and waits for the car to come
///     online (single semaphore per vehicle, no thundering herd).
///
/// Every endpoint returns a uniform <see cref="CommandResponse"/> body
/// (<c>{ ok, wokeUp?, error? }</c>) so the SPA can render a single
/// feedback bubble regardless of which button was tapped.
/// </summary>
public static class TeslaControlEndpoints
{
    public static void MapTeslaControlEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/tesla-control").RequireAuthorization();

        // ── Discovery / state ────────────────────────────────────────────────

        group.MapGet("/availability", GetAvailability);
        group.MapGet("/{vehicleId:int}/state", GetState);
        group.MapPost("/{vehicleId:int}/wake", Wake);

        // ── Climate ──────────────────────────────────────────────────────────

        group.MapPost("/{vehicleId:int}/climate/start",
            (int vehicleId, TeslaCommandService cmd, CancellationToken ct) =>
                Run(cmd.SendSignedCommandAsync(vehicleId, "auto_conditioning_start", null, ct)));

        group.MapPost("/{vehicleId:int}/climate/stop",
            (int vehicleId, TeslaCommandService cmd, CancellationToken ct) =>
                Run(cmd.SendSignedCommandAsync(vehicleId, "auto_conditioning_stop", null, ct)));

        group.MapPost("/{vehicleId:int}/climate/temps",
            (int vehicleId, ClimateTempsBody body, TeslaCommandService cmd, CancellationToken ct) =>
                Run(cmd.SendSignedCommandAsync(vehicleId, "set_temps",
                    new
                    {
                        driver_temp = body.DriverTemp,
                        passenger_temp = body.PassengerTemp ?? body.DriverTemp,
                    }, ct)));

        group.MapPost("/{vehicleId:int}/climate/precondition",
            (int vehicleId, ToggleBody body, TeslaCommandService cmd, CancellationToken ct) =>
                Run(cmd.SendSignedCommandAsync(vehicleId, "set_preconditioning_max",
                    new { on = body.On, manual_override = false }, ct)));

        // Tesla seat positions (verified against vehicle-command/pkg/proxy/command.go):
        //   0 front-left, 1 front-right, 2 rear-left, 3 rear-left-back,
        //   4 rear-center, 5 rear-right, 6 rear-right-back,
        //   7 third-row-left, 8 third-row-right.
        // Levels 0..3 (Off / Low / Med / High).
        group.MapPost("/{vehicleId:int}/climate/seat-heater",
            (int vehicleId, SeatHeaterBody body, TeslaCommandService cmd, CancellationToken ct) =>
                Run(cmd.SendSignedCommandAsync(vehicleId, "remote_seat_heater_request",
                    new { heater = body.Position, level = body.Level }, ct)));

        group.MapPost("/{vehicleId:int}/climate/steering-wheel-heater",
            (int vehicleId, ToggleBody body, TeslaCommandService cmd, CancellationToken ct) =>
                Run(cmd.SendSignedCommandAsync(vehicleId, "remote_steering_wheel_heater_request",
                    new { on = body.On }, ct)));

        // climate_keeper_mode: 0=Off, 1=On, 2=Dog, 3=Camp.
        group.MapPost("/{vehicleId:int}/climate/keeper",
            (int vehicleId, KeeperModeBody body, TeslaCommandService cmd, CancellationToken ct) =>
                Run(cmd.SendSignedCommandAsync(vehicleId, "set_climate_keeper_mode",
                    new { climate_keeper_mode = body.Mode }, ct)));

        group.MapPost("/{vehicleId:int}/climate/cabin-overheat",
            (int vehicleId, CabinOverheatBody body, TeslaCommandService cmd, CancellationToken ct) =>
                Run(cmd.SendSignedCommandAsync(vehicleId, "set_cabin_overheat_protection",
                    new { on = body.On, fan_only = body.FanOnly }, ct)));

        // cop_temp level: 0=Low (30°C), 1=Medium (35°C), 2=High (40°C).
        group.MapPost("/{vehicleId:int}/climate/cabin-overheat-temp",
            (int vehicleId, CopTempBody body, TeslaCommandService cmd, CancellationToken ct) =>
                Run(cmd.SendSignedCommandAsync(vehicleId, "set_cop_temp",
                    new { cop_temp = body.Level }, ct)));

        group.MapPost("/{vehicleId:int}/climate/bioweapon",
            (int vehicleId, ToggleBody body, TeslaCommandService cmd, CancellationToken ct) =>
                Run(cmd.SendSignedCommandAsync(vehicleId, "set_bioweapon_mode",
                    new { on = body.On, manual_override = false }, ct)));

        // ── Charging ────────────────────────────────────────────────────────

        group.MapPost("/{vehicleId:int}/charge/start",
            (int vehicleId, TeslaCommandService cmd, CancellationToken ct) =>
                Run(cmd.SendSignedCommandAsync(vehicleId, "charge_start", null, ct)));

        group.MapPost("/{vehicleId:int}/charge/stop",
            (int vehicleId, TeslaCommandService cmd, CancellationToken ct) =>
                Run(cmd.SendSignedCommandAsync(vehicleId, "charge_stop", null, ct)));

        group.MapPost("/{vehicleId:int}/charge/limit",
            (int vehicleId, ChargeLimitBody body, TeslaCommandService cmd, CancellationToken ct) =>
                Run(cmd.SendSignedCommandAsync(vehicleId, "set_charge_limit",
                    new { percent = body.Percent }, ct)));

        group.MapPost("/{vehicleId:int}/charge/amps",
            (int vehicleId, ChargeAmpsBody body, TeslaCommandService cmd, CancellationToken ct) =>
                Run(cmd.SendSignedCommandAsync(vehicleId, "set_charging_amps",
                    new { charging_amps = body.Amps }, ct)));

        group.MapPost("/{vehicleId:int}/charge/port-door",
            (int vehicleId, ToggleBody body, TeslaCommandService cmd, CancellationToken ct) =>
                Run(cmd.SendSignedCommandAsync(vehicleId,
                    body.On ? "charge_port_door_open" : "charge_port_door_close", null, ct)));

        // ── Access (locks, sentry, lights, horn, valet) ─────────────────────

        group.MapPost("/{vehicleId:int}/access/lock",
            (int vehicleId, TeslaCommandService cmd, CancellationToken ct) =>
                Run(cmd.SendSignedCommandAsync(vehicleId, "door_lock", null, ct)));

        group.MapPost("/{vehicleId:int}/access/unlock",
            (int vehicleId, TeslaCommandService cmd, CancellationToken ct) =>
                Run(cmd.SendSignedCommandAsync(vehicleId, "door_unlock", null, ct)));

        group.MapPost("/{vehicleId:int}/access/flash-lights",
            (int vehicleId, TeslaCommandService cmd, CancellationToken ct) =>
                Run(cmd.SendSignedCommandAsync(vehicleId, "flash_lights", null, ct)));

        group.MapPost("/{vehicleId:int}/access/honk-horn",
            (int vehicleId, TeslaCommandService cmd, CancellationToken ct) =>
                Run(cmd.SendSignedCommandAsync(vehicleId, "honk_horn", null, ct)));

        group.MapPost("/{vehicleId:int}/access/remote-start",
            (int vehicleId, TeslaCommandService cmd, CancellationToken ct) =>
                Run(cmd.SendSignedCommandAsync(vehicleId, "remote_start_drive", null, ct)));

        group.MapPost("/{vehicleId:int}/access/sentry",
            (int vehicleId, ToggleBody body, TeslaCommandService cmd, CancellationToken ct) =>
                Run(cmd.SendSignedCommandAsync(vehicleId, "set_sentry_mode",
                    new { on = body.On }, ct)));

        group.MapPost("/{vehicleId:int}/access/valet",
            (int vehicleId, ValetBody body, TeslaCommandService cmd, CancellationToken ct) =>
                Run(cmd.SendSignedCommandAsync(vehicleId, "set_valet_mode",
                    new { on = body.On, password = body.Pin }, ct)));

        group.MapPost("/{vehicleId:int}/access/speed-limit/set",
            (int vehicleId, SpeedLimitBody body, TeslaCommandService cmd, CancellationToken ct) =>
                Run(cmd.SendSignedCommandAsync(vehicleId, "speed_limit_set_limit",
                    new { limit_mph = body.Mph }, ct)));

        group.MapPost("/{vehicleId:int}/access/speed-limit/activate",
            (int vehicleId, PinBody body, TeslaCommandService cmd, CancellationToken ct) =>
                Run(cmd.SendSignedCommandAsync(vehicleId, "speed_limit_activate",
                    new { pin = body.Pin }, ct)));

        group.MapPost("/{vehicleId:int}/access/speed-limit/deactivate",
            (int vehicleId, PinBody body, TeslaCommandService cmd, CancellationToken ct) =>
                Run(cmd.SendSignedCommandAsync(vehicleId, "speed_limit_deactivate",
                    new { pin = body.Pin }, ct)));

        group.MapPost("/{vehicleId:int}/access/speed-limit/clear-pin",
            (int vehicleId, PinBody body, TeslaCommandService cmd, CancellationToken ct) =>
                Run(cmd.SendSignedCommandAsync(vehicleId, "speed_limit_clear_pin",
                    new { pin = body.Pin }, ct)));

        // ── Openings (trunks, windows) ──────────────────────────────────────

        group.MapPost("/{vehicleId:int}/access/trunk",
            (int vehicleId, TrunkBody body, TeslaCommandService cmd, CancellationToken ct) =>
                Run(cmd.SendSignedCommandAsync(vehicleId, "actuate_trunk",
                    new { which_trunk = body.Which }, ct)));

        // window_control: lat/lon are NOT required for vehicles supporting
        // the signed protocol (per pkg/proxy/command.go comment).
        group.MapPost("/{vehicleId:int}/access/window",
            (int vehicleId, WindowBody body, TeslaCommandService cmd, CancellationToken ct) =>
                Run(cmd.SendSignedCommandAsync(vehicleId, "window_control",
                    new { command = body.Command, lat = 0, lon = 0 }, ct)));

        // ── Media ───────────────────────────────────────────────────────────

        group.MapPost("/{vehicleId:int}/media/play",
            (int vehicleId, TeslaCommandService cmd, CancellationToken ct) =>
                Run(cmd.SendSignedCommandAsync(vehicleId, "media_toggle_playback", null, ct)));

        group.MapPost("/{vehicleId:int}/media/next",
            (int vehicleId, TeslaCommandService cmd, CancellationToken ct) =>
                Run(cmd.SendSignedCommandAsync(vehicleId, "media_next_track", null, ct)));

        group.MapPost("/{vehicleId:int}/media/prev",
            (int vehicleId, TeslaCommandService cmd, CancellationToken ct) =>
                Run(cmd.SendSignedCommandAsync(vehicleId, "media_prev_track", null, ct)));

        group.MapPost("/{vehicleId:int}/media/next-fav",
            (int vehicleId, TeslaCommandService cmd, CancellationToken ct) =>
                Run(cmd.SendSignedCommandAsync(vehicleId, "media_next_fav", null, ct)));

        group.MapPost("/{vehicleId:int}/media/prev-fav",
            (int vehicleId, TeslaCommandService cmd, CancellationToken ct) =>
                Run(cmd.SendSignedCommandAsync(vehicleId, "media_prev_fav", null, ct)));

        group.MapPost("/{vehicleId:int}/media/volume-up",
            (int vehicleId, TeslaCommandService cmd, CancellationToken ct) =>
                Run(cmd.SendSignedCommandAsync(vehicleId, "media_volume_up", null, ct)));

        group.MapPost("/{vehicleId:int}/media/volume-down",
            (int vehicleId, TeslaCommandService cmd, CancellationToken ct) =>
                Run(cmd.SendSignedCommandAsync(vehicleId, "media_volume_down", null, ct)));

        group.MapPost("/{vehicleId:int}/media/volume",
            (int vehicleId, VolumeBody body, TeslaCommandService cmd, CancellationToken ct) =>
                Run(cmd.SendSignedCommandAsync(vehicleId, "adjust_volume",
                    new { volume = body.Volume }, ct)));

        // ── Software updates ────────────────────────────────────────────────

        group.MapPost("/{vehicleId:int}/software/schedule-update",
            (int vehicleId, ScheduleUpdateBody body, TeslaCommandService cmd, CancellationToken ct) =>
                Run(cmd.SendSignedCommandAsync(vehicleId, "schedule_software_update",
                    new { offset_sec = body.OffsetSec }, ct)));

        group.MapPost("/{vehicleId:int}/software/cancel-update",
            (int vehicleId, TeslaCommandService cmd, CancellationToken ct) =>
                Run(cmd.SendSignedCommandAsync(vehicleId, "cancel_software_update", null, ct)));
    }

    // ── Special handlers (availability + state + wake) ───────────────────────

    private static async Task<IResult> GetAvailability(
        AppDbContext db,
        TeslaOAuthService oauth,
        CancellationToken ct)
    {
        var status = await oauth.GetStatusAsync(ct);
        var vehicles = await db.Set<TeslaVehicle>()
            .OrderBy(v => v.DisplayName ?? v.Vin)
            .Select(v => new
            {
                v.Id,
                v.Vin,
                v.DisplayName,
                v.Model,
                v.KeyPaired,
                v.TelemetryConfigured,
                v.CapabilitiesJson,
            })
            .ToListAsync(ct);

        var dtos = vehicles.Select(v =>
        {
            var caps = new TeslaVehicle { CapabilitiesJson = v.CapabilitiesJson }.GetCapabilities();
            return new TeslaControlVehicleDto
            {
                Id = v.Id,
                Vin = v.Vin,
                DisplayName = v.DisplayName,
                Model = v.Model,
                KeyPaired = v.KeyPaired,
                TelemetryConfigured = v.TelemetryConfigured,
                Capabilities = caps,
            };
        }).ToArray();

        return Results.Ok(new TeslaControlAvailabilityDto
        {
            Configured = status.Configured,
            Connected = status.Connected,
            Vehicles = dtos,
        });
    }

    private static async Task<IResult> GetState(
        int vehicleId,
        [FromQuery(Name = "force")] bool? force,
        TeslaCommandService commands,
        CancellationToken ct)
    {
        try
        {
            var snapshot = await commands.GetStateAsync(vehicleId, force ?? false, ct);
            return Results.Ok(snapshot);
        }
        catch (TeslaCommandException ex)
        {
            return MapException(ex);
        }
    }

    private static async Task<IResult> Wake(
        int vehicleId,
        TeslaCommandService commands,
        CancellationToken ct)
    {
        try
        {
            var outcome = await commands.EnsureAwakeAsync(vehicleId, ct);
            if (outcome.Awoken)
                return Results.Ok(new CommandResponse(true, true, null));
            return Results.Problem(
                title: "Vehicle did not wake",
                detail: outcome.Detail,
                statusCode: 504);
        }
        catch (TeslaCommandException ex)
        {
            return MapException(ex);
        }
    }

    // ── Shared response shaping ─────────────────────────────────────────────

    private static async Task<IResult> Run(Task<CommandResult> task)
    {
        try
        {
            var result = await task;
            if (result.Success)
                return Results.Ok(new CommandResponse(true, result.WokeUp, null));

            var statusCode = result.FailureKind switch
            {
                CommandFailureKind.InvalidRequest => 400,
                CommandFailureKind.Unauthorized => 401,
                CommandFailureKind.VehicleNotFound => 404,
                CommandFailureKind.NotConfigured => 503,
                CommandFailureKind.KeyNotPaired => 409,
                CommandFailureKind.RateLimited => 429,
                CommandFailureKind.Rejected => 422,
                CommandFailureKind.VehicleUnreachable => 504,
                _ => 502,
            };

            return Results.Problem(
                title: result.FailureKind.ToString(),
                detail: result.Error,
                statusCode: statusCode,
                extensions: new Dictionary<string, object?>
                {
                    ["wokeUp"] = result.WokeUp,
                });
        }
        catch (TeslaCommandException ex)
        {
            return MapException(ex);
        }
    }

    private static IResult MapException(TeslaCommandException ex)
    {
        var statusCode = ex.FailureKind switch
        {
            CommandFailureKind.VehicleNotFound => 404,
            CommandFailureKind.NotConfigured => 503,
            CommandFailureKind.KeyNotPaired => 409,
            _ => 400,
        };
        return Results.Problem(
            title: ex.FailureKind.ToString(),
            detail: ex.Message,
            statusCode: statusCode);
    }
}

// ── DTOs ─────────────────────────────────────────────────────────────────────

public sealed record CommandResponse(bool Ok, bool? WokeUp, string? Error);

public sealed record TeslaControlAvailabilityDto
{
    public bool Configured { get; init; }
    public bool Connected { get; init; }
    public TeslaControlVehicleDto[] Vehicles { get; init; } = [];
}

public sealed record TeslaControlVehicleDto
{
    public int Id { get; init; }
    public string Vin { get; init; } = string.Empty;
    public string? DisplayName { get; init; }
    public string? Model { get; init; }
    public bool KeyPaired { get; init; }
    public bool TelemetryConfigured { get; init; }
    public VehicleCapabilities Capabilities { get; init; } = new();
}

public sealed record ToggleBody(bool On);
public sealed record PinBody(string Pin);
public sealed record ValetBody(bool On, string? Pin);
public sealed record SpeedLimitBody(int Mph);
public sealed record ClimateTempsBody(double DriverTemp, double? PassengerTemp);
public sealed record SeatHeaterBody(int Position, int Level);
public sealed record KeeperModeBody(int Mode);
public sealed record CabinOverheatBody(bool On, bool FanOnly);
public sealed record CopTempBody(int Level);
public sealed record ChargeLimitBody(int Percent);
public sealed record ChargeAmpsBody(int Amps);
public sealed record TrunkBody(string Which);
public sealed record WindowBody(string Command);
public sealed record VolumeBody(double Volume);
public sealed record ScheduleUpdateBody(int OffsetSec);
