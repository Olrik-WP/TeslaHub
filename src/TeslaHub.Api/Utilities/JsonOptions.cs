using System.Text.Json;
using System.Text.Json.Serialization;

namespace TeslaHub.Api.Utilities;

/// <summary>
/// Centralized JSON serialization profiles used outside of the default
/// minimal-API serializer (e.g. for SSE payloads that bypass Results.Ok).
/// </summary>
public static class JsonOptions
{
    /// <summary>
    /// camelCase output, drops nulls — matches the default ASP.NET Core JSON
    /// settings so SSE consumers see the same shape as REST responses.
    /// </summary>
    public static readonly JsonSerializerOptions Live = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };
}
