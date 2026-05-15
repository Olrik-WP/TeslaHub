using System.ComponentModel.DataAnnotations;

namespace TeslaHub.Api.Models;

/// <summary>
/// Per-vehicle dynamic load-shedding configuration. The runtime engine
/// reads the live MQTT power feed published by Zigbee2MQTT (typically
/// from a ZLinky TIC) and clamps Tesla charging amps so the house total
/// stays under the subscription limit.
///
/// One profile per TeslaVehicle (unique). Created on first save from the
/// Settings UI; until then the engine ignores the vehicle entirely.
/// </summary>
public class LoadSheddingProfile
{
    [Key] public int Id { get; set; }

    public int TeslaVehicleId { get; set; }
    public TeslaVehicle? TeslaVehicle { get; set; }

    /// <summary>Master switch. When false, the engine ignores this profile entirely.</summary>
    public bool Enabled { get; set; }

    /// <summary>
    /// Test mode: the engine still computes decisions and writes
    /// LoadSheddingEvent rows tagged "DryRun", but never calls the Tesla
    /// Fleet API. Used to validate thresholds against real traffic
    /// without risking the actual charge session.
    /// </summary>
    public bool DryRun { get; set; } = true;

    public int MaxAmps { get; set; } = 32;
    public int MinAmps { get; set; } = 6;
    public int TargetReducedAmps { get; set; } = 20;

    public int HighThresholdVa { get; set; } = 9500;
    public int LowThresholdVa { get; set; } = 7000;

    public int HighWindowSeconds { get; set; } = 30;
    public int LowWindowSeconds { get; set; } = 900;

    public int CooldownSeconds { get; set; } = 60;
    public int MinAmpsDelta { get; set; } = 2;

    public int HourlyCommandQuota { get; set; } = 30;
    public int DailyCommandQuota { get; set; } = 200;

    /// <summary>
    /// Minimum number of distinct (post-dedup) samples required in the
    /// sliding window before the engine accepts a transition. Prevents
    /// reacting on a single orphan reading after a long MQTT silence.
    /// </summary>
    public int MinSamplesInWindow { get; set; } = 2;

    /// <summary>MQTT topic published by Z2M for the smart-meter device. Default targets ZLinky.</summary>
    [MaxLength(200)]
    public string MqttTopic { get; set; } = "zigbee2mqtt/Lixee";

    /// <summary>
    /// Dot-notation JSON path inside the MQTT payload pointing to the
    /// instantaneous house power. Default `apparent_power` (ZLinky in
    /// TIC standard). Other examples: `em.total_act_power` (Shelly Pro
    /// 3EM Gen2), `ENERGY.Power` (Tasmota), `0.power` (array index).
    /// Empty when the payload IS already the raw scalar (P1 readers,
    /// per-channel Shelly Gen1 emeter feeds).
    /// </summary>
    [MaxLength(100)]
    public string PowerJsonField { get; set; } = "apparent_power";

    /// <summary>
    /// Display unit of the house power, used as a suffix in the UI
    /// (Settings panel, runtime tile, audit timeline). Stored values and
    /// thresholds are always in this same unit AFTER applying
    /// <see cref="PowerScale"/>. Typical values: "VA" (Linky / ZLinky),
    /// "W" (most everything else: Shelly, Tasmota, IoTaWatt, Emporia,
    /// converted DSMR P1).
    /// </summary>
    [MaxLength(10)]
    public string PowerUnit { get; set; } = "VA";

    /// <summary>
    /// Multiplier applied to the raw value parsed from the MQTT payload
    /// before storing it as an integer. Lets us accept fractional units
    /// (kW from a P1 reader: scale=1000, gives an integer count of W)
    /// without leaking floats through the rest of the pipeline.
    /// Defaults to 1 (no scaling — value passes through).
    /// </summary>
    public double PowerScale { get; set; } = 1.0;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// Audit row written by the engine on every meaningful decision (or
/// non-decision: skips, quota hits, errors). Surfaces a timeline in the
/// Settings panel so the user can verify the engine is doing something
/// sensible without grepping container logs.
/// </summary>
public class LoadSheddingEvent
{
    [Key] public long Id { get; set; }

    public int TeslaVehicleId { get; set; }

    public DateTime At { get; set; } = DateTime.UtcNow;

    /// <summary>Reduce, Raise, DryRunReduce, DryRunRaise, Skip, QuotaHit, ProxyError, NoData.</summary>
    [MaxLength(40)]
    public string Kind { get; set; } = string.Empty;

    public int? FromAmps { get; set; }
    public int? ToAmps { get; set; }
    public int? HouseVa { get; set; }

    [MaxLength(500)]
    public string? Detail { get; set; }
}
