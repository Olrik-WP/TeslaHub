using TeslaHub.Api.Models;
using TeslaHub.Api.Services;

namespace TeslaHub.Api.Endpoints;

/// <summary>
/// HTTP endpoints powering the Tesla virtual-key pairing wizard:
///   - public-key publication at /.well-known/appspecific/com.tesla.3p.public-key.pem
///   - keypair generation, partner-domain registration, vehicle discovery
///     and per-vehicle pairing flag toggling under /api/tesla-pairing/*.
/// </summary>
public static class TeslaPairingEndpoints
{
    public static void MapTeslaPairingEndpoints(this WebApplication app)
    {
        app.MapGet(TeslaKeyService.WellKnownEndpointPath, async (TeslaKeyService keys, CancellationToken ct) =>
        {
            var keypair = await keys.GetCurrentAsync(ct);
            if (keypair is null)
                return Results.NotFound("Public key has not been generated yet.");

            return Results.Text(keypair.PublicKeyPem, "application/x-pem-file");
        }).AllowAnonymous();

        var group = app.MapGroup("/api/tesla-pairing").RequireAuthorization();

        group.MapGet("/status", async (TeslaPairingService pairing, CancellationToken ct) =>
            Results.Ok(await pairing.GetStatusAsync(ct)));

        group.MapPost("/keypair", async (
            TeslaKeyGenerationRequest? request,
            TeslaPairingService pairing,
            HttpContext ctx,
            CancellationToken ct) =>
        {
            var domain = request?.Domain ?? string.Empty;
            if (string.IsNullOrWhiteSpace(domain))
            {
                domain = ctx.Request.Headers["X-Forwarded-Host"].FirstOrDefault()
                    ?? ctx.Request.Host.Value
                    ?? string.Empty;
            }

            if (string.IsNullOrWhiteSpace(domain))
                return Results.BadRequest(new { error = "A non-empty public domain is required." });

            try
            {
                var keypair = await pairing.GenerateKeypairAsync(domain, ct);
                return Results.Ok(new
                {
                    domain = keypair.Domain,
                    publicKeyUrl = TeslaKeyService.PublicKeyUrl(keypair.Domain),
                    pairingUrl = TeslaKeyService.PairingUrl(keypair.Domain),
                });
            }
            catch (Exception ex)
            {
                return Results.Problem(detail: ex.Message, statusCode: 500);
            }
        });

        group.MapPost("/register-partner", async (TeslaPairingService pairing, CancellationToken ct) =>
        {
            try
            {
                var result = await pairing.RegisterPartnerDomainAsync(ct);
                return result.Success
                    ? Results.Ok(new { registered = true })
                    : Results.Problem(title: "Partner registration failed", detail: result.Error, statusCode: 502);
            }
            catch (InvalidOperationException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
        });

        group.MapPost("/sync-vehicles", async (TeslaPairingService pairing, CancellationToken ct) =>
        {
            try
            {
                var count = await pairing.SyncVehiclesAsync(ct);
                return Results.Ok(new { count });
            }
            catch (InvalidOperationException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
        });

        group.MapPost("/vehicles/{id:int}/paired", async (
            int id,
            VehiclePairedRequest body,
            TeslaPairingService pairing,
            CancellationToken ct) =>
        {
            var ok = await pairing.MarkVehiclePairedAsync(id, body.Paired, ct);
            return ok ? Results.NoContent() : Results.NotFound();
        });
    }

    public sealed record VehiclePairedRequest(bool Paired);
}
