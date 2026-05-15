namespace TeslaHub.Api.Models;

/// <summary>
/// What the Settings panel sees when it loads. One row per known Tesla
/// vehicle, plus a per-vehicle profile if one has ever been saved, plus
/// a runtime snapshot the panel can use to render live status.
/// </summary>
public sealed class LoadSheddingStatusDto
{
    public LoadSheddingHouseDto House { get; set; } = new();
    public LoadSheddingVehicleDto[] Vehicles { get; set; } = Array.Empty<LoadSheddingVehicleDto>();
    public bool MqttConnected { get; set; }
    public string? MqttTopic { get; set; }
}

public sealed class LoadSheddingHouseDto
{
    public int? CurrentVa { get; set; }
    public DateTime? LastSampleAt { get; set; }
    public int SamplesInLast60s { get; set; }

    /// <summary>
    /// Display unit for CurrentVa (and per-vehicle TeslaVa). Echoes the
    /// PowerUnit of the active profile so the SPA can render a consistent
    /// suffix without guessing. Defaults to "VA" when no profile exists.
    /// </summary>
    public string Unit { get; set; } = "VA";
}

public sealed class LoadSheddingVehicleDto
{
    public int VehicleId { get; set; }
    public string Vin { get; set; } = string.Empty;
    public string? DisplayName { get; set; }

    public LoadSheddingProfileDto? Profile { get; set; }
    public LoadSheddingRuntimeDto Runtime { get; set; } = new();
}

public sealed class LoadSheddingProfileDto
{
    public int Id { get; set; }
    public bool Enabled { get; set; }
    public bool DryRun { get; set; }

    public int MaxAmps { get; set; }
    public int MinAmps { get; set; }
    public int TargetReducedAmps { get; set; }

    public int HighThresholdVa { get; set; }
    public int LowThresholdVa { get; set; }

    public int HighWindowSeconds { get; set; }
    public int LowWindowSeconds { get; set; }

    public int CooldownSeconds { get; set; }
    public int MinAmpsDelta { get; set; }

    public int HourlyCommandQuota { get; set; }
    public int DailyCommandQuota { get; set; }

    public int MinSamplesInWindow { get; set; }

    public string MqttTopic { get; set; } = string.Empty;
    public string PowerJsonField { get; set; } = string.Empty;
    public string PowerUnit { get; set; } = "VA";
    public double PowerScale { get; set; } = 1.0;
}

public sealed class LoadSheddingRuntimeDto
{
    public string State { get; set; } = "Unknown";
    public string? ChargingState { get; set; }
    public int? CurrentAmps { get; set; }
    public int? TeslaVa { get; set; }
    public DateTime? LastCommandAt { get; set; }
    public int CommandsLastHour { get; set; }
    public int CommandsLastDay { get; set; }
}

/// <summary>Body accepted by PUT /api/load-shedding/profiles/{vehicleId}.</summary>
public sealed class LoadSheddingProfileUpsertRequest
{
    public bool Enabled { get; set; }
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

    public int MinSamplesInWindow { get; set; } = 2;

    public string MqttTopic { get; set; } = "zigbee2mqtt/Lixee";
    public string PowerJsonField { get; set; } = "apparent_power";
    public string PowerUnit { get; set; } = "VA";
    public double PowerScale { get; set; } = 1.0;
}

public sealed class LoadSheddingEventDto
{
    public long Id { get; set; }
    public int TeslaVehicleId { get; set; }
    public DateTime At { get; set; }
    public string Kind { get; set; } = string.Empty;
    public int? FromAmps { get; set; }
    public int? ToAmps { get; set; }
    public int? HouseVa { get; set; }
    public string? Detail { get; set; }
}
