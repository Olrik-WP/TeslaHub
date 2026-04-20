using Microsoft.EntityFrameworkCore;
using TeslaHub.Api.Data;
using TeslaHub.Api.Models;
using TeslaHub.Api.Services;

namespace TeslaHub.Api.Endpoints;

/// <summary>
/// Endpoints powering the "Send to Vehicle" feature on the Map page.
///   GET  /api/tesla-share/targets — list paired vehicles eligible to receive a destination
///   POST /api/tesla-share/{id}/destination — actually push a destination to one vehicle
/// </summary>
public static class TeslaShareEndpoints
{
    public static void MapTeslaShareEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/tesla-share").RequireAuthorization();

        group.MapGet("/targets", async (
            AppDbContext db,
            TeslaOAuthService oauth,
            CancellationToken ct) =>
        {
            var status = await oauth.GetStatusAsync(ct);
            var vehicles = await db.Set<TeslaVehicle>()
                .OrderBy(v => v.DisplayName ?? v.Vin)
                .Select(v => new TeslaShareTargetDto
                {
                    Id = v.Id,
                    Vin = v.Vin,
                    DisplayName = v.DisplayName,
                    Model = v.Model,
                    KeyPaired = v.KeyPaired,
                })
                .ToListAsync(ct);

            return Results.Ok(new TeslaShareAvailabilityDto
            {
                Configured = status.Configured,
                Connected = status.Connected,
                Vehicles = vehicles.ToArray(),
            });
        });

        group.MapPost("/{vehicleId:int}/destination", async (
            int vehicleId,
            ShareDestinationBody body,
            TeslaShareService share,
            HttpContext ctx,
            CancellationToken ct) =>
        {
            if (body is null || string.IsNullOrWhiteSpace(body.Value))
                return Results.BadRequest(new { error = "value is required (address, lat,lng or URL)." });

            var locale = body.Locale;
            if (string.IsNullOrWhiteSpace(locale))
            {
                var header = ctx.Request.Headers.AcceptLanguage.ToString();
                if (!string.IsNullOrEmpty(header))
                    locale = header.Split(',')[0].Trim();
            }

            var result = await share.SendDestinationAsync(
                vehicleId,
                new ShareDestinationRequest(body.Value, locale),
                ct);

            if (result.Success)
                return Results.Ok(new { sent = true, wokeUp = result.WokeUp });

            var statusCode = result.FailureKind switch
            {
                ShareFailureKind.InvalidRequest => 400,
                ShareFailureKind.NotConfigured => 503,
                ShareFailureKind.KeyNotPaired => 409,
                ShareFailureKind.VehicleNotFound => 404,
                ShareFailureKind.Unauthorized => 401,
                ShareFailureKind.Rejected => 422,
                ShareFailureKind.VehicleUnreachable => 504,
                _ => 502,
            };

            var title = result.FailureKind switch
            {
                ShareFailureKind.NotConfigured => "Tesla Fleet API not configured",
                ShareFailureKind.KeyNotPaired => "Virtual key not paired with this vehicle",
                ShareFailureKind.VehicleNotFound => "Vehicle not found",
                ShareFailureKind.Unauthorized => "Tesla rejected the request",
                ShareFailureKind.VehicleUnreachable => "Vehicle did not respond in time",
                ShareFailureKind.InvalidRequest => "Invalid destination",
                ShareFailureKind.Rejected => "Tesla refused the destination",
                _ => "Send to vehicle failed",
            };

            return Results.Problem(title: title, detail: result.Error, statusCode: statusCode);
        });
    }

    public sealed record ShareDestinationBody(string Value, string? Locale);
}

public sealed record TeslaShareAvailabilityDto
{
    public bool Configured { get; init; }
    public bool Connected { get; init; }
    public TeslaShareTargetDto[] Vehicles { get; init; } = [];
}

public sealed record TeslaShareTargetDto
{
    public int Id { get; init; }
    public string Vin { get; init; } = string.Empty;
    public string? DisplayName { get; init; }
    public string? Model { get; init; }
    public bool KeyPaired { get; init; }
}
