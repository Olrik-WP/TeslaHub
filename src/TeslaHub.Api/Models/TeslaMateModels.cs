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
}

public record ChargePointDto
{
    public DateTime Date { get; init; }
    public int? BatteryLevel { get; init; }
    public double? ChargeEnergyAdded { get; init; }
    public int? ChargerPower { get; init; }
    public double? RatedBatteryRangeKm { get; init; }
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
