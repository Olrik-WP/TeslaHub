namespace TeslaHub.Api.TeslaMate;

/// <summary>
/// Reusable SQL fragments composed against TeslaMate's standard schema.
/// Always alias <c>geofences</c> as <c>g</c> and <c>addresses</c> as <c>a</c>
/// when joining, so these snippets resolve correctly inside larger queries.
/// </summary>
internal static class TeslaMateSql
{
    /// <summary>
    /// Best-effort human-readable address: prefers a TeslaMate geofence name,
    /// falls back to a composed street + city from the addresses table.
    /// Resolves to NULL when neither is available.
    /// </summary>
    public const string AddressExpression =
        "COALESCE(g.name, CONCAT_WS(', ', COALESCE(a.name, NULLIF(CONCAT_WS(' ', a.road, a.house_number), '')), a.city))";

    /// <summary>
    /// Same as <see cref="AddressExpression"/> but coerces NULL to 'Other'
    /// so it can safely be used in GROUP BY / cost bucket labels.
    /// </summary>
    public const string AddressExpressionOrOther =
        "COALESCE(g.name, CONCAT_WS(', ', COALESCE(a.name, NULLIF(CONCAT_WS(' ', a.road, a.house_number), '')), a.city), 'Other')";

    /// <summary>
    /// Variant of <see cref="AddressExpression"/> for queries that join
    /// the same tables under custom aliases (e.g. start/end address joins).
    /// </summary>
    public static string AddressExpressionFor(string geofenceAlias, string addressAlias) =>
        $"COALESCE({geofenceAlias}.name, CONCAT_WS(', ', COALESCE({addressAlias}.name, NULLIF(CONCAT_WS(' ', {addressAlias}.road, {addressAlias}.house_number), '')), {addressAlias}.city))";
}
