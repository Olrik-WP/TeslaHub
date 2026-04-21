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
using System.Text.Json;

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

    /// <summary>
    /// Raw JSON of the most recent <c>vehicle_config</c> sub-tree returned
    /// by <c>GET /api/1/vehicles/{id}/vehicle_data</c>. Used to hide buttons
    /// the car cannot honour (frunk, heated rear seats, motorized port,
    /// sun roof, etc.). Refreshed automatically on every cached state read.
    /// </summary>
    public string? CapabilitiesJson { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    /// <summary>
    /// Defensive deserialiser. Returns an empty record when the cache is
    /// missing or malformed, so callers never need to null-check.
    /// </summary>
    public VehicleCapabilities GetCapabilities()
    {
        if (string.IsNullOrWhiteSpace(CapabilitiesJson))
            return new VehicleCapabilities();
        try
        {
            using var doc = JsonDocument.Parse(CapabilitiesJson);
            var root = doc.RootElement;
            return new VehicleCapabilities
            {
                CarType = TryString(root, "car_type"),
                TrimBadging = TryString(root, "trim_badging"),
                RearSeatHeaters = TryInt(root, "rear_seat_heaters") ?? 0,
                ThirdRowSeats = TryString(root, "third_row_seats"),
                SunRoofInstalled = TryInt(root, "sun_roof_installed") ?? 0,
                MotorizedChargePort = TryBool(root, "motorized_charge_port") ?? false,
                CanActuateTrunks = TryBool(root, "can_actuate_trunks") ?? false,
                CanAcceptNavigationRequests = TryBool(root, "can_accept_navigation_requests") ?? false,
                Plg = TryBool(root, "plg") ?? false,
                Pws = TryBool(root, "pws") ?? false,
                HasAirSuspension = TryBool(root, "has_air_suspension") ?? false,
                HasLudicrousMode = TryBool(root, "has_ludicrous_mode") ?? false,
                Rhd = TryBool(root, "rhd") ?? false,
                ChargePortType = TryString(root, "charge_port_type"),
                EuVehicle = TryBool(root, "eu_vehicle") ?? false,
            };
        }
        catch
        {
            return new VehicleCapabilities();
        }
    }

    private static string? TryString(JsonElement root, string property) =>
        root.TryGetProperty(property, out var el) && el.ValueKind == JsonValueKind.String
            ? el.GetString() : null;

    private static int? TryInt(JsonElement root, string property)
    {
        if (!root.TryGetProperty(property, out var el)) return null;
        if (el.ValueKind == JsonValueKind.Number && el.TryGetInt32(out var i)) return i;
        if (el.ValueKind == JsonValueKind.String && int.TryParse(el.GetString(), out var s)) return s;
        return null;
    }

    private static bool? TryBool(JsonElement root, string property) =>
        root.TryGetProperty(property, out var el) && (el.ValueKind == JsonValueKind.True || el.ValueKind == JsonValueKind.False)
            ? el.GetBoolean() : (bool?)null;
}

/// <summary>
/// Strongly-typed projection of the <c>vehicle_config</c> fields TeslaHub
/// cares about. Anything not in here lives in <see cref="TeslaVehicle.CapabilitiesJson"/>
/// for forward-compatibility (Tesla regularly adds new keys).
/// </summary>
public sealed record VehicleCapabilities
{
    public string? CarType { get; init; }
    public string? TrimBadging { get; init; }
    public int RearSeatHeaters { get; init; }
    public string? ThirdRowSeats { get; init; }
    public int SunRoofInstalled { get; init; }
    public bool MotorizedChargePort { get; init; }
    public bool CanActuateTrunks { get; init; }
    public bool CanAcceptNavigationRequests { get; init; }
    public bool Plg { get; init; }
    public bool Pws { get; init; }
    public bool HasAirSuspension { get; init; }
    public bool HasLudicrousMode { get; init; }
    public bool Rhd { get; init; }
    public string? ChargePortType { get; init; }
    public bool EuVehicle { get; init; }

    public bool HasRearSeatHeaters => RearSeatHeaters > 0;
    public bool HasThirdRow =>
        !string.IsNullOrEmpty(ThirdRowSeats) &&
        !string.Equals(ThirdRowSeats, "None", StringComparison.OrdinalIgnoreCase);
    public bool HasSunRoof => SunRoofInstalled > 0;
}

// ─── DTOs ────────────────────────────────────────────────────────────────────

public record TeslaOAuthStatusDto
{
    public bool Configured { get; init; }
    public bool Connected { get; init; }

    // Legacy single-account fields describe the most recently updated
    // account. Kept for backward compatibility with older clients.
    public string? Email { get; init; }
    public string? FullName { get; init; }
    public DateTime? ConnectedAt { get; init; }
    public DateTime? AccessTokenExpiresAt { get; init; }
    public DateTime? LastRefreshAt { get; init; }
    public int RefreshFailureCount { get; init; }
    public string? LastRefreshError { get; init; }
    public string[] Scopes { get; init; } = [];
    public int VehicleCount { get; init; }

    /// <summary>
    /// Full list of connected Tesla accounts. TeslaHub supports linking
    /// several Tesla identities (typically a couple sharing one car
    /// park) so each vehicle is reached with the OAuth token of its
    /// actual owner, which is the only way Tesla lets signed commands
    /// succeed for non-owner-shared vehicles.
    /// </summary>
    public TeslaAccountSummaryDto[] Accounts { get; init; } = [];
}

public record TeslaAccountSummaryDto
{
    public int Id { get; init; }
    public string? Email { get; init; }
    public string? FullName { get; init; }
    public DateTime ConnectedAt { get; init; }
    public DateTime AccessTokenExpiresAt { get; init; }
    public DateTime? LastRefreshAt { get; init; }
    public int RefreshFailureCount { get; init; }
    public string? LastRefreshError { get; init; }
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

    /// <summary>
    /// Owner account id + email. Populated so the wizard can group
    /// vehicles by their owning Tesla identity (useful on multi-account
    /// installs: "Kitt belongs to you@example.com, Nyx belongs to
    /// wife@example.com"). null on pre-multi-account clients.
    /// </summary>
    public int? AccountId { get; init; }
    public string? AccountEmail { get; init; }
}

/// <summary>
/// EC P-256 keypair used to register TeslaHub as a Tesla third-party app.
/// The public key is exposed at /.well-known/appspecific/com.tesla.3p.public-key.pem
/// and must be paired with each vehicle from the Tesla mobile app before
/// telemetry can be received.
/// </summary>
public class TeslaKeyPair
{
    [Key]
    public int Id { get; set; }

    [Required]
    public string PublicKeyPem { get; set; } = string.Empty;

    [Required]
    public string EncryptedPrivateKeyPem { get; set; } = string.Empty;

    [Required, MaxLength(255)]
    public string Domain { get; set; } = string.Empty;

    public bool PartnerRegistered { get; set; }
    public DateTime? PartnerRegisteredAt { get; set; }

    [MaxLength(1000)]
    public string? PartnerRegistrationError { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public record TeslaPairingStatusDto
{
    public bool KeyGenerated { get; init; }
    public string? Domain { get; init; }
    public string? PublicKeyUrl { get; init; }
    public bool PartnerRegistered { get; init; }
    public DateTime? PartnerRegisteredAt { get; init; }
    public string? PartnerRegistrationError { get; init; }
    public string? PairingUrl { get; init; }
    public TeslaVehicleDto[] Vehicles { get; init; } = [];
}

public record TeslaKeyGenerationRequest
{
    public string? Domain { get; init; }
}
