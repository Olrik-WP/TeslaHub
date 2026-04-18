namespace TeslaHub.Api.Models;

/// <summary>
/// String values stored in <see cref="ChargingLocation.PricingType"/>.
/// Kept as constants (not an enum) because they round-trip through JSON DTOs
/// and are persisted in the database as plain text.
/// </summary>
public static class PricingTypes
{
    public const string Manual = "manual";
    public const string Home = "home";
    public const string Subscription = "subscription";
}

/// <summary>
/// Period selectors accepted by cost / statistics endpoints.
/// </summary>
public static class CostPeriods
{
    public const string Day = "day";
    public const string Week = "week";
    public const string Month = "month";
    public const string Year = "year";
    public const string Custom = "custom";
    public const string All = "all";
}
