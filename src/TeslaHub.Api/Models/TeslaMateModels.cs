namespace TeslaHub.Api.Models;

public record VehicleDto
{
    public int CarId { get; init; }
    public string? Name { get; init; }
    public string? Model { get; init; }
    public string? MarketingName { get; init; }
    public string? TrimBadging { get; init; }
    public string? ExteriorColor { get; init; }
    public string? WheelType { get; init; }
    public string? Vin { get; init; }
    public double? Efficiency { get; init; }

    public double? BatteryLevel { get; init; }
    public double? UsableBatteryLevel { get; init; }
    public double? RatedBatteryRangeKm { get; init; }
    public double? IdealBatteryRangeKm { get; init; }
    public double? Odometer { get; init; }
    public double? Latitude { get; init; }
    public double? Longitude { get; init; }
    public double? InsideTemp { get; init; }
    public double? OutsideTemp { get; init; }
    public double? Speed { get; init; }
    public int? Power { get; init; }
    public DateTime? PositionDate { get; init; }
    public string? State { get; init; }
    public string? FirmwareVersion { get; init; }
    public double? CurrentCapacityKwh { get; init; }
    public double? MaxCapacityKwh { get; init; }
    public double KmSinceLastCharge { get; init; }

    // TPMS pressures (persisted in positions table)
    public double? TpmsPressureFl { get; init; }
    public double? TpmsPressureFr { get; init; }
    public double? TpmsPressureRl { get; init; }
    public double? TpmsPressureRr { get; init; }

    // Climate (persisted in positions table)
    public bool? IsClimateOn { get; init; }
    public double? DriverTempSetting { get; init; }
    public double? PassengerTempSetting { get; init; }
    public bool? IsFrontDefrosterOn { get; init; }
    public bool? IsRearDefrosterOn { get; init; }

    // TPMS warnings (MQTT live only)
    public bool? TpmsSoftWarningFl { get; init; }
    public bool? TpmsSoftWarningFr { get; init; }
    public bool? TpmsSoftWarningRl { get; init; }
    public bool? TpmsSoftWarningRr { get; init; }

    // Body / Security (MQTT live only)
    public bool? IsLocked { get; init; }
    public bool? DoorsOpen { get; init; }
    public bool? TrunkOpen { get; init; }
    public bool? FrunkOpen { get; init; }
    public bool? WindowsOpen { get; init; }
    public bool? SentryMode { get; init; }
    public bool? IsUserPresent { get; init; }

    // Climate extras (MQTT live only)
    public string? ClimateKeeperMode { get; init; }
    public bool? IsPreconditioning { get; init; }

    // MQTT connectivity
    public bool MqttConnected { get; init; }
}

public record DriveDto
{
    public int Id { get; init; }
    public int CarId { get; init; }
    public DateTime StartDate { get; init; }
    public DateTime? EndDate { get; init; }
    public double? StartKm { get; init; }
    public double? EndKm { get; init; }
    public double? Distance { get; init; }
    public int? DurationMin { get; init; }
    public int? SpeedMax { get; init; }
    public int? PowerMax { get; init; }
    public int? PowerMin { get; init; }
    public double? StartRatedRangeKm { get; init; }
    public double? EndRatedRangeKm { get; init; }
    public double? OutsideTempAvg { get; init; }
    public double? InsideTempAvg { get; init; }
    public double? Ascent { get; init; }
    public double? Descent { get; init; }
    public string? StartAddress { get; init; }
    public string? EndAddress { get; init; }
    public double? ConsumptionKWhPer100Km { get; init; }
    public double? StartBatteryLevel { get; init; }
    public double? EndBatteryLevel { get; init; }
    public double? SpeedAvg { get; init; }
    public double? NetEnergyKwh { get; init; }
    public double? Efficiency { get; init; }
    public bool HasReducedRange { get; init; }
}

public record PositionDto
{
    public int Id { get; init; }
    public DateTime Date { get; init; }
    public double Latitude { get; init; }
    public double Longitude { get; init; }
    public double? Speed { get; init; }
    public int? Power { get; init; }
    public double? BatteryLevel { get; init; }
    public double? Elevation { get; init; }
    public double? Odometer { get; init; }
    public double? RatedBatteryRangeKm { get; init; }
}

public record ChargingSessionDto
{
    public int Id { get; init; }
    public int CarId { get; init; }
    public DateTime StartDate { get; init; }
    public DateTime? EndDate { get; init; }
    public double? ChargeEnergyAdded { get; init; }
    public double? ChargeEnergyUsed { get; init; }
    public int? StartBatteryLevel { get; init; }
    public int? EndBatteryLevel { get; init; }
    public int? DurationMin { get; init; }
    public double? OutsideTempAvg { get; init; }
    public double? StartRatedRangeKm { get; init; }
    public double? EndRatedRangeKm { get; init; }
    public double? Cost { get; init; }
    public string? Address { get; init; }
    public int? GeofenceId { get; init; }
    public string? GeofenceName { get; init; }
    public double? Latitude { get; init; }
    public double? Longitude { get; init; }
    public bool? FastChargerPresent { get; init; }
    public string? FastChargerType { get; init; }
    public string? ChargeType { get; init; }
    public double? Efficiency { get; init; }
    public double? AvgPowerKw { get; init; }
    public double? ChargeRateKmPerHour { get; init; }
    public double? RangeAddedKm { get; init; }
    public double? CostPerKwh { get; init; }
    public double? Odometer { get; init; }
    public double? DistanceSinceLastCharge { get; init; }
    public int? MaxCurrent { get; init; }
    public int? MaxVoltage { get; init; }
    public string? ConnChargeCable { get; init; }
}

public record ChargePointDto
{
    public DateTime Date { get; init; }
    public int? BatteryLevel { get; init; }
    public double? ChargeEnergyAdded { get; init; }
    public int? ChargerPower { get; init; }
    public double? RatedBatteryRangeKm { get; init; }
    public int? ChargerActualCurrent { get; init; }
    public int? ChargerVoltage { get; init; }
    public string? ConnChargeCable { get; init; }
}

public record GeofenceDto
{
    public int Id { get; init; }
    public string Name { get; init; } = string.Empty;
    public double Latitude { get; init; }
    public double Longitude { get; init; }
    public double Radius { get; init; }
}

public record StatsDto
{
    public string Period { get; init; } = string.Empty;
    public double TotalDistanceKm { get; init; }
    public double TotalEnergyAddedKWh { get; init; }
    public int DriveCount { get; init; }
    public int ChargeCount { get; init; }
    public double AvgConsumptionKWhPer100Km { get; init; }
}

public record DriveStatsDto
{
    public int DriveCount { get; init; }
    public double? MaxSpeedKmh { get; init; }
    public double? MedianDistanceKm { get; init; }
    public double TotalDistanceKm { get; init; }
    public double TotalNetEnergyKwh { get; init; }
    public double TotalDays { get; init; }
    public double TotalMileageKm { get; init; }
}

public record ChargingStatsDto
{
    public int ChargeCount { get; init; }
    public double TotalEnergyAdded { get; init; }
    public double TotalEnergyUsed { get; init; }
    public double ChargingEfficiency { get; init; }
}

public record ChargingSummaryDto
{
    public int ChargeCount { get; init; }
    public double TotalEnergyAdded { get; init; }
    public double TotalEnergyUsed { get; init; }
    public double TotalCost { get; init; }
    public double AvgDurationMin { get; init; }
    public double AvgEfficiency { get; init; }
}

public record CarListItemDto
{
    public int Id { get; init; }
    public string? Name { get; init; }
    public string? Model { get; init; }
    public string? MarketingName { get; init; }
    public string? Vin { get; init; }
}

public record ChargingCurvePointDto
{
    public int SoC { get; init; }
    public double Power { get; init; }
    public int ChargingProcessId { get; init; }
    public string? Label { get; init; }
}

public record ChargingCurveMedianDto
{
    public int SoC { get; init; }
    public double Power { get; init; }
}

public record VampireDrainDto
{
    public DateTime StartDate { get; init; }
    public DateTime EndDate { get; init; }
    public double DurationSec { get; init; }
    public double? Standby { get; init; }
    public double? SocDiff { get; init; }
    public bool HasReducedRange { get; init; }
    public double? RangeDiffKm { get; init; }
    public double? ConsumptionKwh { get; init; }
    public double? AvgPowerW { get; init; }
    public double? RangeLostPerHourKm { get; init; }
}

public record VampireSummaryDto
{
    public int SessionCount { get; init; }
    public double TotalKwh { get; init; }
    public double AvgWh { get; init; }
    public double AvgPowerW { get; init; }
}

// ─── Mileage ─────────────────────────────────────────────────────
public record MileagePointDto
{
    public DateTime Date { get; init; }
    public double OdometerKm { get; init; }
}

// ─── Updates ─────────────────────────────────────────────────────
public record UpdateItemDto
{
    public DateTime StartDate { get; init; }
    public DateTime? EndDate { get; init; }
    public double? DurationMin { get; init; }
    public string Version { get; init; } = string.Empty;
    public double? SinceLastDays { get; init; }
}

public record UpdatesStatsDto
{
    public int TotalCount { get; init; }
    public double? MedianIntervalDays { get; init; }
    public string? CurrentVersion { get; init; }
}

// ─── Efficiency ──────────────────────────────────────────────────
public record EfficiencySummaryDto
{
    public double? AvgConsumptionNetKwhPer100Km { get; init; }
    public double? AvgConsumptionGrossKwhPer100Km { get; init; }
    public double? TotalDistanceKm { get; init; }
    public double? CurrentEfficiencyWhPerKm { get; init; }
    public List<DerivedEfficiencyDto> DerivedEfficiencies { get; init; } = new();
    public List<TempEfficiencyDto> TemperatureEfficiency { get; init; } = new();
}

public record DerivedEfficiencyDto
{
    public double EfficiencyKwhPer100Km { get; init; }
    public int Count { get; init; }
}

public record TempEfficiencyDto
{
    public double TemperatureC { get; init; }
    public double ConsumptionKwhPer100Km { get; init; }
    public double TotalDistanceKm { get; init; }
}

// ─── Battery Health ──────────────────────────────────────────────
public record BatteryHealthDto
{
    public double? CurrentCapacityKwh { get; init; }
    public double? MaxCapacityKwh { get; init; }
    public double? DegradationPct { get; init; }
    public double? HealthPct { get; init; }
    public double? StoredEnergyKwh { get; init; }
    public int? ChargeCount { get; init; }
    public double? ChargeCycles { get; init; }
    public double? TotalEnergyAddedKwh { get; init; }
    public double? TotalEnergyUsedKwh { get; init; }
    public double? ChargingEfficiencyPct { get; init; }
    public double? MedianCapacity { get; init; }
    public List<CapacityPointDto> CapacityByMileage { get; init; } = new();
}

public record CapacityPointDto
{
    public double OdometerKm { get; init; }
    public double CapacityKwh { get; init; }
    public string Date { get; init; } = string.Empty;
}

public record ChargeLevelPointDto
{
    public DateTime Date { get; init; }
    public double? BatteryLevel { get; init; }
    public double? UsableBatteryLevel { get; init; }
}

public record ProjectedRangePointDto
{
    public DateTime Date { get; init; }
    public double? ProjectedRangeKm { get; init; }
    public double? BatteryLevel { get; init; }
}

// ─── States ──────────────────────────────────────────────────────
public record StatesSummaryDto
{
    public string? CurrentState { get; init; }
    public double? ParkedPct { get; init; }
    public double? DrivingPct { get; init; }
    public List<StateSegmentDto> Segments { get; init; } = new();
}

public record StateSegmentDto
{
    public string State { get; init; } = string.Empty;
    public double Pct { get; init; }
}

public record TimelineEntryDto
{
    public string Action { get; init; } = string.Empty;
    public DateTime StartDate { get; init; }
    public DateTime? EndDate { get; init; }
    public double? DurationMin { get; init; }
    public string? StartAddress { get; init; }
    public string? EndAddress { get; init; }
    public double? DistanceKm { get; init; }
    public double? EnergyKwh { get; init; }
    public double? SocEnd { get; init; }
}

// ─── Statistics ──────────────────────────────────────────────────
public record PeriodStatsDto
{
    public string Label { get; init; } = string.Empty;
    public double? DistanceKm { get; init; }
    public int DriveCount { get; init; }
    public double? DriveDurationMin { get; init; }
    public double? AvgTempC { get; init; }
    public double? EnergyAddedKwh { get; init; }
    public int ChargeCount { get; init; }
    public decimal? ChargeCost { get; init; }
    public double? ConsumptionNetKwhPer100Km { get; init; }
}

// ─── Database Info ──────────────────────────────────────────────
public record DatabaseInfoDto
{
    public string PostgresVersion { get; init; } = string.Empty;
    public string Timezone { get; init; } = string.Empty;
    public long? SharedBuffersBytes { get; init; }
    public long? TotalSizeBytes { get; init; }
}

public record TableSizeDto
{
    public string TableName { get; init; } = string.Empty;
    public long DataBytes { get; init; }
    public long IndexBytes { get; init; }
    public long TotalBytes { get; init; }
}

public record TableRowCountDto
{
    public string TableName { get; init; } = string.Empty;
    public long RowCount { get; init; }
}

public record IndexStatDto
{
    public string TableName { get; init; } = string.Empty;
    public string IndexName { get; init; } = string.Empty;
    public long IndexScans { get; init; }
    public long TuplesRead { get; init; }
    public long TuplesFetched { get; init; }
    public long IndexSizeBytes { get; init; }
}

public record DataStatsDto
{
    public int DriveCount { get; init; }
    public int ChargeCount { get; init; }
    public int UpdateCount { get; init; }
    public double? TotalDistanceKm { get; init; }
    public double? OdometerKm { get; init; }
    public string? CurrentFirmware { get; init; }
    public int UnclosedDrives { get; init; }
    public int UnclosedCharges { get; init; }
}

public record LocationStatsDto
{
    public int AddressCount { get; init; }
    public int CityCount { get; init; }
    public int StateCount { get; init; }
    public int CountryCount { get; init; }
}

public record VisitedLocationDto
{
    public string Address { get; init; } = string.Empty;
    public string? City { get; init; }
    public string? State { get; init; }
    public string? Country { get; init; }
    public double? Latitude { get; init; }
    public double? Longitude { get; init; }
    public int VisitCount { get; init; }
    public DateTime LastVisited { get; init; }
}

public record TopCityDto
{
    public string City { get; init; } = string.Empty;
    public int Count { get; init; }
}

public record TripSummaryDto
{
    public int DriveCount { get; init; }
    public int ChargeCount { get; init; }
    public double TotalDistanceKm { get; init; }
    public int TotalDriveMin { get; init; }
    public int TotalChargeMin { get; init; }
    public double TotalEnergyUsedKwh { get; init; }
    public double TotalEnergyAddedKwh { get; init; }
    public double? AvgConsumption { get; init; }
    public double? AvgSpeedKmh { get; init; }
    public double? AvgOutsideTemp { get; init; }
}

public record TripSegmentDto
{
    public string Type { get; init; } = string.Empty;
    public int Id { get; init; }
    public DateTime StartDate { get; init; }
    public DateTime? EndDate { get; init; }
    public int? DurationMin { get; init; }
    public double? DistanceKm { get; init; }
    public double? EnergyKwh { get; init; }
    public string? StartAddress { get; init; }
    public string? EndAddress { get; init; }
    public int? StartBattery { get; init; }
    public int? EndBattery { get; init; }
    public double? AvgSpeedKmh { get; init; }
    public double? Consumption { get; init; }
}
