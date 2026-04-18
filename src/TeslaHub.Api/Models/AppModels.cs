using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace TeslaHub.Api.Models;

public class AppUser
{
    [Key]
    public int Id { get; set; }

    [Required, MaxLength(100)]
    public string Username { get; set; } = string.Empty;

    [Required]
    public string PasswordHash { get; set; } = string.Empty;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class GlobalSettings
{
    [Key]
    public int Id { get; set; }

    [MaxLength(10)]
    public string Currency { get; set; } = "EUR";

    [MaxLength(10)]
    public string UnitOfLength { get; set; } = "km";

    [MaxLength(10)]
    public string UnitOfTemperature { get; set; } = "C";

    [MaxLength(10)]
    public string UnitOfPressure { get; set; } = "bar";

    public int? DefaultCarId { get; set; }

    [MaxLength(500)]
    public string MapTileUrl { get; set; } = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

    [MaxLength(20)]
    public string CostSource { get; set; } = "teslahub";

    [MaxLength(5)]
    public string Language { get; set; } = "en";

    [MaxLength(20)]
    public string DashboardGaugeMode { get; set; } = "analog";

    [MaxLength(20)]
    public string DashboardColorPreset { get; set; } = "teslaRed";

    public int DashboardMaxScale { get; set; } = 200;

    [MaxLength(20)]
    public string MapStyle { get; set; } = "liberty3d";
}

public class CarConfig
{
    [Key]
    public int Id { get; set; }

    public int CarId { get; set; }

    [MaxLength(100)]
    public string? DisplayName { get; set; }

    [MaxLength(20)]
    public string? ColorOverride { get; set; }

    public bool IsActive { get; set; } = true;

    [Column(TypeName = "decimal(10,4)")]
    public decimal? GasPricePerLiter { get; set; }

    [Column(TypeName = "decimal(10,2)")]
    public decimal? GasConsumptionLPer100Km { get; set; }

    [MaxLength(50)]
    public string? GasVehicleName { get; set; }
}

/// <summary>
/// A named charging location with its pricing configuration.
/// Pricing types: "home" (peak/off-peak), "subscription" (monthly flat), "manual" (per-session entry).
/// </summary>
public class ChargingLocation
{
    [Key]
    public int Id { get; set; }

    [Required, MaxLength(200)]
    public string Name { get; set; } = string.Empty;

    public double Latitude { get; set; }
    public double Longitude { get; set; }
    public int RadiusMeters { get; set; } = 200;

    [Required, MaxLength(20)]
    public string PricingType { get; set; } = PricingTypes.Manual;

    [Column(TypeName = "decimal(10,4)")]
    public decimal? PeakPricePerKwh { get; set; }

    [Column(TypeName = "decimal(10,4)")]
    public decimal? OffPeakPricePerKwh { get; set; }

    public TimeOnly? OffPeakStart { get; set; }
    public TimeOnly? OffPeakEnd { get; set; }

    [Column(TypeName = "decimal(10,2)")]
    public decimal? MonthlySubscription { get; set; }

    public int? CarId { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public class ChargingCostOverride
{
    [Key]
    public int Id { get; set; }

    public int ChargingProcessId { get; set; }
    public int CarId { get; set; }

    [Column(TypeName = "decimal(10,4)")]
    public decimal? PricePerKwh { get; set; }

    [Column(TypeName = "decimal(10,2)")]
    public decimal TotalCost { get; set; }

    public bool IsFree { get; set; }
    public bool IsManualOverride { get; set; }

    public int? LocationId { get; set; }

    [ForeignKey(nameof(LocationId))]
    public ChargingLocation? Location { get; set; }

    [MaxLength(500)]
    public string? Notes { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public class CarImage
{
    [Key]
    public int Id { get; set; }

    public int CarId { get; set; }

    [MaxLength(20)]
    public string? PaintCode { get; set; }

    [MaxLength(20)]
    public string? WheelCode { get; set; }

    public bool IsCustomUpload { get; set; }

    public byte[] ImageData { get; set; } = [];

    [MaxLength(50)]
    public string ContentType { get; set; } = "image/jpeg";

    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

// ─── DTOs ──────────────────────────────────────────────────────

public record ChargingLocationCreateDto
{
    public string Name { get; init; } = string.Empty;
    public double Latitude { get; init; }
    public double Longitude { get; init; }
    public int RadiusMeters { get; init; } = 200;
    public string PricingType { get; init; } = PricingTypes.Manual;
    public decimal? PeakPricePerKwh { get; init; }
    public decimal? OffPeakPricePerKwh { get; init; }
    public string? OffPeakStart { get; init; }
    public string? OffPeakEnd { get; init; }
    public decimal? MonthlySubscription { get; init; }
    public int? CarId { get; init; }
}

public record SessionCostDto
{
    public int ChargingProcessId { get; init; }
    public int CarId { get; init; }
    public decimal? PricePerKwh { get; init; }
    public decimal? TotalCost { get; init; }
    public bool IsFree { get; init; }
    public string? Notes { get; init; }
    public double? Latitude { get; init; }
    public double? Longitude { get; init; }
    public double? EnergyKwh { get; init; }
}

public record CostSummaryDto
{
    public string Period { get; init; } = string.Empty;
    public decimal TotalCost { get; init; }
    public decimal TotalKwh { get; init; }
    public decimal AvgPricePerKwh { get; init; }
    public decimal CostPerKm { get; init; }
    public decimal TotalDistanceKm { get; init; }
    public int SessionCount { get; init; }
    public int FreeSessionCount { get; init; }
    public Dictionary<string, decimal> CostByLocation { get; init; } = new();
    public decimal SubscriptionCost { get; init; }
}

public record MonthlyTrendDto
{
    public string Month { get; init; } = string.Empty;
    public decimal Cost { get; init; }
}
