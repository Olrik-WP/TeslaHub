// ─────────────────────────────────────────────────────────────────────────────
// TeslaHub Security Alerts — Tesla OAuth Foundation
//
// This module powers the optional "Security Alerts" feature that brings
// real-time Tesla Sentry / Break-In notifications to TeslaHub.
//
// The overall design (Fleet API OAuth, encrypted token storage, Fleet
// Telemetry stream consumption with Telegram fan-out) is heavily inspired
// by the SentryGuard project by Anas Barghoud:
//   https://github.com/abarghoud/SentryGuard  (AGPL-3.0)
//
// All code in this file is an original C# implementation written for
// TeslaHub. SentryGuard is referenced as the architectural blueprint only.
// TeslaHub itself is licensed under AGPL-3.0, fully compatible.
// ─────────────────────────────────────────────────────────────────────────────

using System.ComponentModel.DataAnnotations;

namespace TeslaHub.Api.Models;

/// <summary>
/// Represents a connected Tesla account (Fleet API OAuth).
/// One TeslaHub instance typically has one account (the family Tesla account),
/// but the schema allows multiple to support shared installations.
/// Tokens are stored encrypted at rest using AES-GCM.
/// </summary>
public class TeslaAccount
{
    [Key]
    public int Id { get; set; }

    [Required, MaxLength(255)]
    public string TeslaUserId { get; set; } = string.Empty;

    [MaxLength(255)]
    public string? Email { get; set; }

    [MaxLength(100)]
    public string? FullName { get; set; }

    [Required]
    public string EncryptedAccessToken { get; set; } = string.Empty;

    [Required]
    public string EncryptedRefreshToken { get; set; } = string.Empty;

    public DateTime AccessTokenExpiresAt { get; set; }

    [MaxLength(500)]
    public string Scopes { get; set; } = string.Empty;

    [MaxLength(255)]
    public string Audience { get; set; } = string.Empty;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    public DateTime? LastRefreshAt { get; set; }
    public int RefreshFailureCount { get; set; }

    [MaxLength(1000)]
    public string? LastRefreshError { get; set; }
}

/// <summary>
/// Represents a Tesla vehicle attached to a TeslaAccount, discovered via
/// the Fleet API /vehicles endpoint. Used as a target for telemetry pairing
/// and notification routing in later PRs.
/// </summary>
public class TeslaVehicle
{
    [Key]
    public int Id { get; set; }

    public int TeslaAccountId { get; set; }
    public TeslaAccount? TeslaAccount { get; set; }

    [Required, MaxLength(17)]
    public string Vin { get; set; } = string.Empty;

    public long TeslaVehicleId { get; set; }

    [MaxLength(100)]
    public string? DisplayName { get; set; }

    [MaxLength(50)]
    public string? Model { get; set; }

    public bool TelemetryConfigured { get; set; }
    public bool KeyPaired { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

// ─── DTOs ────────────────────────────────────────────────────────────────────

public record TeslaOAuthStatusDto
{
    public bool Configured { get; init; }
    public bool Connected { get; init; }
    public string? Email { get; init; }
    public string? FullName { get; init; }
    public DateTime? ConnectedAt { get; init; }
    public DateTime? AccessTokenExpiresAt { get; init; }
    public DateTime? LastRefreshAt { get; init; }
    public int RefreshFailureCount { get; init; }
    public string? LastRefreshError { get; init; }
    public string[] Scopes { get; init; } = [];
    public int VehicleCount { get; init; }
}

public record TeslaOAuthLoginDto
{
    public string AuthorizeUrl { get; init; } = string.Empty;
    public string State { get; init; } = string.Empty;
}

public record TeslaVehicleDto
{
    public int Id { get; init; }
    public string Vin { get; init; } = string.Empty;
    public string? DisplayName { get; init; }
    public string? Model { get; init; }
    public bool TelemetryConfigured { get; init; }
    public bool KeyPaired { get; init; }
}
