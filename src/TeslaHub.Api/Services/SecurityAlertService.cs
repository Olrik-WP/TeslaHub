// ─────────────────────────────────────────────────────────────────────────────
// SecurityAlertService — turns Tesla telemetry events into Telegram
// notifications fanned out to subscribed recipients.
//
// Detection logic (SentryModeStateAware ⇒ alert) and the
// recipient × vehicle dispatch pattern are inspired by SentryGuard
// (https://github.com/abarghoud/SentryGuard, AGPL-3.0).
// Reimplemented in C#/.NET for TeslaHub. Both projects are AGPL-3.0.
// ─────────────────────────────────────────────────────────────────────────────

using Microsoft.EntityFrameworkCore;
using TeslaHub.Api.Data;
using TeslaHub.Api.Models;

namespace TeslaHub.Api.Services;

public sealed class SecurityAlertService
{
    private readonly AppDbContext _db;
    private readonly TelegramNotificationService _telegram;
    private readonly ILogger<SecurityAlertService> _logger;

    public SecurityAlertService(
        AppDbContext db,
        TelegramNotificationService telegram,
        ILogger<SecurityAlertService> logger)
    {
        _db = db;
        _telegram = telegram;
        _logger = logger;
    }

    public async Task ProcessTelemetryAsync(TeslaTelemetryMessage message, CancellationToken cancellationToken)
    {
        if (string.IsNullOrEmpty(message.Vin))
            return;

        var sentry = message.GetSentryModeState();
        if (sentry == SentryModeState.Aware || sentry == SentryModeState.Panic)
        {
            await TriggerAsync(message.Vin, "SENTRY_ALERT",
                $"Sentry detected activity around the vehicle ({sentry}).",
                s => s.SentryAlerts,
                cancellationToken);
        }

        if (IsLikelyBreakIn(message))
        {
            await TriggerAsync(message.Vin, "BREAK_IN",
                "Door open while vehicle is locked and unattended.",
                s => s.BreakInAlerts,
                cancellationToken);
        }
    }

    private static bool IsLikelyBreakIn(TeslaTelemetryMessage message)
    {
        var locked = message.GetLockedState();
        var doorState = message.GetDoorState();
        if (locked != true || string.IsNullOrEmpty(doorState))
            return false;

        var s = doorState.ToLowerInvariant();
        return s.Contains("open") || s.Contains("opening");
    }

    private async Task TriggerAsync(
        string vin,
        string alertType,
        string detail,
        Func<RecipientVehicleSubscription, bool> subscriptionFilter,
        CancellationToken cancellationToken)
    {
        var vehicle = await _db.Set<TeslaVehicle>().FirstOrDefaultAsync(v => v.Vin == vin, cancellationToken);
        if (vehicle is null)
        {
            _logger.LogWarning("Telemetry alert {AlertType} for unknown VIN {Vin}, ignoring.", alertType, vin);
            return;
        }

        var subscriptions = await _db.Set<RecipientVehicleSubscription>()
            .Include(s => s.Recipient)
            .Where(s => s.TeslaVehicleId == vehicle.Id)
            .ToListAsync(cancellationToken);

        var targets = subscriptions
            .Where(subscriptionFilter)
            .Where(s => s.Recipient is not null && s.Recipient.IsActive)
            .Select(s => s.Recipient!)
            .GroupBy(r => r.Id)
            .Select(g => g.First())
            .ToList();

        var alert = new SecurityAlertEvent
        {
            Vin = vin,
            VehicleDisplayName = vehicle.DisplayName,
            AlertType = alertType,
            Detail = detail,
            DetectedAt = DateTime.UtcNow,
        };

        if (targets.Count == 0)
        {
            _logger.LogInformation("Telemetry alert {AlertType} for VIN {Vin} but no active recipient subscribed.",
                alertType, vin);
            _db.Set<SecurityAlertEvent>().Add(alert);
            await _db.SaveChangesAsync(cancellationToken);
            return;
        }

        var notified = 0;
        var failed = 0;
        var lastError = (string?)null;

        foreach (var recipient in targets)
        {
            var label = vehicle.DisplayName ?? vin;
            var emoji = alertType == "SENTRY_ALERT" ? "🚨" : "🔓";
            var body = $"{emoji} <b>{System.Net.WebUtility.HtmlEncode(label)}</b>\n{System.Net.WebUtility.HtmlEncode(detail)}";

            var result = await _telegram.SendAsync(recipient.ChannelTarget, body, cancellationToken);
            if (result.Success)
            {
                notified++;
            }
            else
            {
                failed++;
                lastError = result.Error;
            }
        }

        alert.RecipientsNotified = notified;
        alert.RecipientsFailed = failed;
        alert.FailureReason = lastError;
        _db.Set<SecurityAlertEvent>().Add(alert);
        await _db.SaveChangesAsync(cancellationToken);

        _logger.LogInformation("Dispatched {AlertType} for {Vin}: {Notified} notified, {Failed} failed.",
            alertType, vin, notified, failed);
    }
}
