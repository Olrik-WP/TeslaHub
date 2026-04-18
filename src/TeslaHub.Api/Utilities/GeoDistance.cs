namespace TeslaHub.Api.Utilities;

/// <summary>
/// Geographic helpers shared by C# services and reused across SQL queries.
/// </summary>
public static class GeoDistance
{
    /// <summary>
    /// Mean Earth radius in meters. Keep this aligned with the literal
    /// 6371000 used in raw SQL (e.g. ChargingQueries.GetChargingSessionsForLocationAsync).
    /// </summary>
    public const double EarthRadiusMeters = 6_371_000d;

    /// <summary>
    /// Great-circle distance between two WGS84 points using the Haversine formula.
    /// </summary>
    public static double HaversineMeters(double lat1, double lon1, double lat2, double lon2)
    {
        var dLat = ToRadians(lat2 - lat1);
        var dLon = ToRadians(lon2 - lon1);
        var a = Math.Sin(dLat / 2) * Math.Sin(dLat / 2)
              + Math.Cos(ToRadians(lat1)) * Math.Cos(ToRadians(lat2))
              * Math.Sin(dLon / 2) * Math.Sin(dLon / 2);
        return EarthRadiusMeters * 2 * Math.Atan2(Math.Sqrt(a), Math.Sqrt(1 - a));
    }

    private static double ToRadians(double degrees) => degrees * Math.PI / 180.0;
}
