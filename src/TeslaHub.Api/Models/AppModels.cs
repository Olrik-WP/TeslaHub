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

    public int? DefaultCarId { get; set; }

    [MaxLength(500)]
    public string MapTileUrl { get; set; } = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
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
}

public class PriceRule
{
    [Key]
    public int Id { get; set; }

    public int? CarId { get; set; }

    [Required, MaxLength(200)]
    public string Label { get; set; } = string.Empty;

    [Column(TypeName = "decimal(10,4)")]
    public decimal PricePerKwh { get; set; }

    [Required, MaxLength(50)]
    public string SourceType { get; set; } = "home";

    [MaxLength(200)]
    public string? LocationName { get; set; }

    public int? GeofenceId { get; set; }

    public TimeOnly? TimeStart { get; set; }
    public TimeOnly? TimeEnd { get; set; }

    public DateTime? ValidFrom { get; set; }
    public DateTime? ValidTo { get; set; }

    public int Priority { get; set; }

    public bool IsActive { get; set; } = true;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class ChargingCostOverride
{
    [Key]
    public int Id { get; set; }

    public int ChargingProcessId { get; set; }

    public int CarId { get; set; }

    [Column(TypeName = "decimal(10,2)")]
    public decimal Cost { get; set; }

    public bool IsFree { get; set; }

    [MaxLength(50)]
    public string? SourceType { get; set; }

    public int? AppliedRuleId { get; set; }

    [ForeignKey(nameof(AppliedRuleId))]
    public PriceRule? AppliedRule { get; set; }

    public bool IsManualOverride { get; set; }

    [MaxLength(500)]
    public string? Notes { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public record PriceRuleCreateDto
{
    public int? CarId { get; init; }
    public string Label { get; init; } = string.Empty;
    public decimal PricePerKwh { get; init; }
    public string SourceType { get; init; } = "home";
    public string? LocationName { get; init; }
    public int? GeofenceId { get; init; }
    public string? TimeStart { get; init; }
    public string? TimeEnd { get; init; }
    public DateTime? ValidFrom { get; init; }
    public DateTime? ValidTo { get; init; }
    public int Priority { get; init; }
}

public record CostOverrideCreateDto
{
    public int ChargingProcessId { get; init; }
    public int CarId { get; init; }
    public decimal Cost { get; init; }
    public bool IsFree { get; init; }
    public string? SourceType { get; init; }
    public string? Notes { get; init; }
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
    public Dictionary<string, decimal> CostBySourceType { get; init; } = new();
}
