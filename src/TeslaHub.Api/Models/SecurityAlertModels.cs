// ─────────────────────────────────────────────────────────────────────────────
// Security Alerts — Telegram delivery + per-recipient routing.
//
// One TeslaHub instance has one (shared) Tesla account but can fan out
// notifications to multiple recipients (e.g. spouses sharing a Tesla
// family account, each with their own Telegram chat). Recipients
// subscribe to specific vehicles via RecipientVehicleSubscription.
// ─────────────────────────────────────────────────────────────────────────────

using System.ComponentModel.DataAnnotations;

namespace TeslaHub.Api.Models;

public class NotificationRecipient
{
    [Key]
    public int Id { get; set; }

    [Required, MaxLength(80)]
    public string Name { get; set; } = string.Empty;

    /// <summary>Channel type — extensible for future ntfy/SMTP/webhook support.</summary>
    [Required, MaxLength(20)]
    public string ChannelType { get; set; } = "telegram";

    /// <summary>For Telegram: numeric chat ID as a string. For ntfy: topic. Etc.</summary>
    [Required, MaxLength(200)]
    public string ChannelTarget { get; set; } = string.Empty;

    public bool IsActive { get; set; } = true;

    [MaxLength(5)]
    public string Language { get; set; } = "en";

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public class RecipientVehicleSubscription
{
    [Key]
    public int Id { get; set; }

    public int RecipientId { get; set; }
    public NotificationRecipient? Recipient { get; set; }

    public int TeslaVehicleId { get; set; }
    public TeslaVehicle? TeslaVehicle { get; set; }

    public bool SentryAlerts { get; set; } = true;
    public bool BreakInAlerts { get; set; } = true;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class SecurityAlertEvent
{
    [Key]
    public int Id { get; set; }

    [Required, MaxLength(17)]
    public string Vin { get; set; } = string.Empty;

    [MaxLength(100)]
    public string? VehicleDisplayName { get; set; }

    [Required, MaxLength(40)]
    public string AlertType { get; set; } = string.Empty;

    [MaxLength(200)]
    public string? Detail { get; set; }

    public DateTime DetectedAt { get; set; } = DateTime.UtcNow;

    public int RecipientsNotified { get; set; }
    public int RecipientsFailed { get; set; }

    [MaxLength(2000)]
    public string? FailureReason { get; set; }
}

// ─── DTOs ────────────────────────────────────────────────────────────────────

public record NotificationRecipientDto
{
    public int Id { get; init; }
    public string Name { get; init; } = string.Empty;
    public string ChannelType { get; init; } = "telegram";
    public string ChannelTarget { get; init; } = string.Empty;
    public bool IsActive { get; init; }
    public string Language { get; init; } = "en";
    public RecipientSubscriptionDto[] Subscriptions { get; init; } = [];
}

public record RecipientSubscriptionDto
{
    public int VehicleId { get; init; }
    public string Vin { get; init; } = string.Empty;
    public string? DisplayName { get; init; }
    public bool SentryAlerts { get; init; }
    public bool BreakInAlerts { get; init; }
}

public record RecipientUpsertRequest
{
    public string Name { get; init; } = string.Empty;
    public string ChannelType { get; init; } = "telegram";
    public string ChannelTarget { get; init; } = string.Empty;
    public bool IsActive { get; init; } = true;
    public string Language { get; init; } = "en";
}

public record SubscriptionUpsertRequest
{
    public int VehicleId { get; init; }
    public bool SentryAlerts { get; init; } = true;
    public bool BreakInAlerts { get; init; } = true;
}

public record AlertEventDto
{
    public int Id { get; init; }
    public string Vin { get; init; } = string.Empty;
    public string? VehicleDisplayName { get; init; }
    public string AlertType { get; init; } = string.Empty;
    public string? Detail { get; init; }
    public DateTime DetectedAt { get; init; }
    public int RecipientsNotified { get; init; }
    public int RecipientsFailed { get; init; }
    public string? FailureReason { get; init; }
}
