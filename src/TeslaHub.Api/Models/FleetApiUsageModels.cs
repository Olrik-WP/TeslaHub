using System.ComponentModel.DataAnnotations;

namespace TeslaHub.Api.Models;

/// <summary>
/// Pricing categories defined by Tesla Fleet API. Each request to the
/// public Fleet API maps to exactly one of these categories, with a
/// per-request unit price. There is NO Tesla endpoint to fetch the real
/// monthly bill — TeslaHub estimates it locally by counting requests
/// (only those with HTTP status &lt; 500, per Tesla billing rules).
///
/// Source: https://developer.tesla.com/docs/fleet-api/billing-and-limits
/// </summary>
public enum FleetApiPricingCategory
{
    /// <summary>POST /api/1/vehicles/{id}/wake_up — $0.02 / request.</summary>
    WakeUp = 0,

    /// <summary>
    /// GET /api/1/vehicles/{id} (state summary) and
    /// GET /api/1/vehicles/{id}/vehicle_data — $0.002 / request.
    /// </summary>
    VehicleData = 1,

    /// <summary>
    /// All POSTs under /api/1/vehicles/{id}/command/* and the
    /// fleet_telemetry_config registration — $0.001 / request.
    /// </summary>
    VehicleCommands = 2,

    /// <summary>
    /// Per-signal Fleet Telemetry usage — $0.0001 / signal. We do not
    /// count this here because telemetry is push-based and TeslaHub has
    /// no reliable way to know how many signals Tesla actually billed.
    /// Reserved for future use.
    /// </summary>
    StreamingData = 3,

    /// <summary>
    /// Partner endpoints (/api/1/partner_accounts, /public_key, …).
    /// Tesla doesn't publish a price for these — Tesla treats them as
    /// account housekeeping. We keep a counter for visibility but do
    /// NOT include them in the cost estimate.
    /// </summary>
    Partner = 4,
}

/// <summary>
/// One row per (year-month, category). Counts are incremented in-process
/// by <c>FleetApiUsageMeter</c> and flushed to disk every few seconds so
/// a process crash loses at most a handful of requests.
/// </summary>
public class FleetApiUsage
{
    [Key]
    public int Id { get; set; }

    /// <summary>Year-month bucket, format yyyy-MM (UTC).</summary>
    [Required, MaxLength(7)]
    public string YearMonth { get; set; } = string.Empty;

    public FleetApiPricingCategory Category { get; set; }

    public long RequestCount { get; set; }

    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// Tesla's published unit prices (USD). Centralised so the UI and the
/// estimator share the same source of truth, and so we can update the
/// table when Tesla revises their pricing without hunting through code.
/// </summary>
public static class FleetApiPricing
{
    public const decimal WakeUpUsd = 0.02m;
    public const decimal VehicleDataUsd = 0.002m;
    public const decimal VehicleCommandsUsd = 0.001m;
    public const decimal StreamingSignalUsd = 0.0001m;

    /// <summary>Monthly automatic credit applied to small-developer accounts.</summary>
    public const decimal MonthlyCreditUsd = 10m;

    public static decimal UnitPrice(FleetApiPricingCategory category) => category switch
    {
        FleetApiPricingCategory.WakeUp => WakeUpUsd,
        FleetApiPricingCategory.VehicleData => VehicleDataUsd,
        FleetApiPricingCategory.VehicleCommands => VehicleCommandsUsd,
        FleetApiPricingCategory.StreamingData => StreamingSignalUsd,
        _ => 0m,
    };
}

// ─── DTOs ──────────────────────────────────────────────────────

public record FleetApiUsageCategoryDto
{
    public string Category { get; init; } = string.Empty;
    public long RequestCount { get; init; }
    public decimal UnitPriceUsd { get; init; }
    public decimal SubtotalUsd { get; init; }
}

public record FleetApiUsageDto
{
    /// <summary>True only when ShowFleetApiCost is enabled in settings.</summary>
    public bool Enabled { get; init; }

    /// <summary>yyyy-MM (UTC) of the current billing month.</summary>
    public string YearMonth { get; init; } = string.Empty;

    /// <summary>UTC start of the period covered by the counts.</summary>
    public DateTime PeriodStartUtc { get; init; }

    /// <summary>UTC time at which this snapshot was generated.</summary>
    public DateTime GeneratedAtUtc { get; init; }

    public FleetApiUsageCategoryDto[] Categories { get; init; } = [];

    /// <summary>Sum of category subtotals before the $10 small-dev credit.</summary>
    public decimal GrossUsd { get; init; }

    /// <summary>Tesla's small-developer monthly credit (currently $10).</summary>
    public decimal CreditUsd { get; init; }

    /// <summary>Estimated bill: max(0, Gross - Credit), rounded to $0.01.</summary>
    public decimal NetUsd { get; init; }

    /// <summary>Same shape, for the previous month — useful for trends.</summary>
    public FleetApiUsagePreviousMonthDto? PreviousMonth { get; init; }
}

public record FleetApiUsagePreviousMonthDto
{
    public string YearMonth { get; init; } = string.Empty;
    public decimal GrossUsd { get; init; }
    public decimal NetUsd { get; init; }
}
