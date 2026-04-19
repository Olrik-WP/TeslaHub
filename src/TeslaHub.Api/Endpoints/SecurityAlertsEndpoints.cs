using Microsoft.EntityFrameworkCore;
using TeslaHub.Api.Data;
using TeslaHub.Api.Models;
using TeslaHub.Api.Services;

namespace TeslaHub.Api.Endpoints;

/// <summary>
/// Endpoints for managing notification recipients, their per-vehicle
/// subscriptions, the alert history, and the Telegram test message.
/// </summary>
public static class SecurityAlertsEndpoints
{
    public static void MapSecurityAlertsEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/security-alerts").RequireAuthorization();

        group.MapGet("/recipients", async (AppDbContext db, CancellationToken ct) =>
        {
            var recipients = await db.NotificationRecipients
                .OrderBy(r => r.Name)
                .ToListAsync(ct);

            var subscriptions = await db.RecipientVehicleSubscriptions
                .Include(s => s.TeslaVehicle)
                .ToListAsync(ct);

            var dtos = recipients.Select(r => new NotificationRecipientDto
            {
                Id = r.Id,
                Name = r.Name,
                ChannelType = r.ChannelType,
                ChannelTarget = r.ChannelTarget,
                IsActive = r.IsActive,
                Language = r.Language,
                Subscriptions = subscriptions
                    .Where(s => s.RecipientId == r.Id && s.TeslaVehicle is not null)
                    .Select(s => new RecipientSubscriptionDto
                    {
                        VehicleId = s.TeslaVehicleId,
                        Vin = s.TeslaVehicle!.Vin,
                        DisplayName = s.TeslaVehicle.DisplayName,
                        SentryAlerts = s.SentryAlerts,
                        BreakInAlerts = s.BreakInAlerts,
                    })
                    .ToArray(),
            }).ToList();

            return Results.Ok(dtos);
        });

        group.MapPost("/recipients", async (
            RecipientUpsertRequest request,
            AppDbContext db,
            CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(request.Name) || string.IsNullOrWhiteSpace(request.ChannelTarget))
                return Results.BadRequest(new { error = "Name and channelTarget are required." });

            var entity = new NotificationRecipient
            {
                Name = request.Name.Trim(),
                ChannelType = string.IsNullOrWhiteSpace(request.ChannelType) ? "telegram" : request.ChannelType.Trim(),
                ChannelTarget = request.ChannelTarget.Trim(),
                IsActive = request.IsActive,
                Language = string.IsNullOrWhiteSpace(request.Language) ? "en" : request.Language.Trim(),
            };
            db.NotificationRecipients.Add(entity);
            await db.SaveChangesAsync(ct);
            return Results.Created($"/api/security-alerts/recipients/{entity.Id}", entity);
        });

        group.MapPut("/recipients/{id:int}", async (
            int id,
            RecipientUpsertRequest request,
            AppDbContext db,
            CancellationToken ct) =>
        {
            var entity = await db.NotificationRecipients.FirstOrDefaultAsync(r => r.Id == id, ct);
            if (entity is null)
                return Results.NotFound();

            entity.Name = request.Name?.Trim() ?? entity.Name;
            entity.ChannelType = string.IsNullOrWhiteSpace(request.ChannelType) ? entity.ChannelType : request.ChannelType.Trim();
            entity.ChannelTarget = string.IsNullOrWhiteSpace(request.ChannelTarget) ? entity.ChannelTarget : request.ChannelTarget.Trim();
            entity.IsActive = request.IsActive;
            entity.Language = string.IsNullOrWhiteSpace(request.Language) ? entity.Language : request.Language.Trim();
            entity.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        });

        group.MapDelete("/recipients/{id:int}", async (int id, AppDbContext db, CancellationToken ct) =>
        {
            var entity = await db.NotificationRecipients.FirstOrDefaultAsync(r => r.Id == id, ct);
            if (entity is null) return Results.NotFound();
            db.NotificationRecipients.Remove(entity);
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        });

        group.MapPost("/recipients/{id:int}/subscriptions", async (
            int id,
            SubscriptionUpsertRequest request,
            AppDbContext db,
            CancellationToken ct) =>
        {
            var recipient = await db.NotificationRecipients.FirstOrDefaultAsync(r => r.Id == id, ct);
            if (recipient is null) return Results.NotFound();

            var existing = await db.RecipientVehicleSubscriptions
                .FirstOrDefaultAsync(s => s.RecipientId == id && s.TeslaVehicleId == request.VehicleId, ct);

            if (existing is null)
            {
                db.RecipientVehicleSubscriptions.Add(new RecipientVehicleSubscription
                {
                    RecipientId = id,
                    TeslaVehicleId = request.VehicleId,
                    SentryAlerts = request.SentryAlerts,
                    BreakInAlerts = request.BreakInAlerts,
                });
            }
            else
            {
                existing.SentryAlerts = request.SentryAlerts;
                existing.BreakInAlerts = request.BreakInAlerts;
            }
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        });

        group.MapDelete("/recipients/{id:int}/subscriptions/{vehicleId:int}", async (
            int id,
            int vehicleId,
            AppDbContext db,
            CancellationToken ct) =>
        {
            var existing = await db.RecipientVehicleSubscriptions
                .FirstOrDefaultAsync(s => s.RecipientId == id && s.TeslaVehicleId == vehicleId, ct);
            if (existing is null) return Results.NotFound();
            db.RecipientVehicleSubscriptions.Remove(existing);
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        });

        group.MapPost("/recipients/{id:int}/test", async (
            int id,
            AppDbContext db,
            TelegramNotificationService telegram,
            CancellationToken ct) =>
        {
            var recipient = await db.NotificationRecipients.FirstOrDefaultAsync(r => r.Id == id, ct);
            if (recipient is null) return Results.NotFound();
            if (!telegram.IsConfigured)
                return Results.Problem(
                    title: "Telegram bot not configured",
                    detail: "Set TELEGRAM_BOT_TOKEN on this TeslaHub instance.",
                    statusCode: 503);

            var result = await telegram.SendAsync(
                recipient.ChannelTarget,
                $"✅ TeslaHub test message for <b>{System.Net.WebUtility.HtmlEncode(recipient.Name)}</b>. " +
                "Security alerts will arrive here when triggered.",
                ct);

            return result.Success
                ? Results.Ok(new { sent = true })
                : Results.Problem(title: "Telegram send failed", detail: result.Error, statusCode: 502);
        });

        group.MapGet("/events", async (
            AppDbContext db,
            int? limit,
            CancellationToken ct) =>
        {
            var take = Math.Clamp(limit ?? 50, 1, 500);
            var events = await db.SecurityAlertEvents
                .OrderByDescending(e => e.DetectedAt)
                .Take(take)
                .Select(e => new AlertEventDto
                {
                    Id = e.Id,
                    Vin = e.Vin,
                    VehicleDisplayName = e.VehicleDisplayName,
                    AlertType = e.AlertType,
                    Detail = e.Detail,
                    DetectedAt = e.DetectedAt,
                    RecipientsNotified = e.RecipientsNotified,
                    RecipientsFailed = e.RecipientsFailed,
                    FailureReason = e.FailureReason,
                })
                .ToListAsync(ct);
            return Results.Ok(events);
        });
    }
}
