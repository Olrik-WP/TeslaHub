// ─────────────────────────────────────────────────────────────────────────────
// Telemetry message parsing.
//
// Tesla's fleet-telemetry server can be configured to dispatch records as
// JSON over NATS (config.json `dispatchers.nats`). The shape we consume
// matches the V (vehicle) records:
//
//   {
//     "vin": "5YJ...",
//     "createdAt": "2025-04-19T18:02:11Z",
//     "data": [
//       { "key": "SentryMode",  "value": { "stringValue": "SentryModeStateAware" } },
//       { "key": "VehicleSpeed","value": { "doubleValue": 0.0 } }
//     ]
//   }
//
// The set of known sentry states mirrors the upstream definitions. We
// only react to SentryModeStateAware (intrusion detected).
//
// Mapping logic and SentryModeState enum derived from SentryGuard
// (https://github.com/abarghoud/SentryGuard, AGPL-3.0).
// ─────────────────────────────────────────────────────────────────────────────

using System.Text.Json;
using System.Text.Json.Serialization;

namespace TeslaHub.Api.Services;

public enum SentryModeState
{
    Unknown,
    Off,
    Idle,
    Armed,
    Aware,
    Panic,
    Quiet,
}

public sealed class TeslaTelemetryMessage
{
    [JsonPropertyName("vin")] public string Vin { get; set; } = string.Empty;
    [JsonPropertyName("createdAt")] public string? CreatedAt { get; set; }
    [JsonPropertyName("data")] public List<TelemetryDatum> Data { get; set; } = new();

    public SentryModeState? GetSentryModeState()
    {
        foreach (var d in Data)
        {
            if (!string.Equals(d.Key, "SentryMode", StringComparison.OrdinalIgnoreCase))
                continue;

            var raw = d.Value?.StringValue ?? d.Value?.SentryModeStateValue;
            if (string.IsNullOrEmpty(raw))
                continue;

            return MapSentryState(raw);
        }
        return null;
    }

    public bool? GetLockedState()
    {
        foreach (var d in Data)
        {
            if (!string.Equals(d.Key, "Locked", StringComparison.OrdinalIgnoreCase))
                continue;
            return d.Value?.BoolValue;
        }
        return null;
    }

    public string? GetDoorState()
    {
        foreach (var d in Data)
        {
            if (!string.Equals(d.Key, "DoorState", StringComparison.OrdinalIgnoreCase))
                continue;
            return d.Value?.StringValue;
        }
        return null;
    }

    private static SentryModeState MapSentryState(string raw) => raw.Trim() switch
    {
        "SentryModeStateOff" or "Off" => SentryModeState.Off,
        "SentryModeStateIdle" or "Idle" => SentryModeState.Idle,
        "SentryModeStateArmed" or "Armed" => SentryModeState.Armed,
        "SentryModeStateAware" or "Aware" => SentryModeState.Aware,
        "SentryModeStatePanic" or "Panic" => SentryModeState.Panic,
        "SentryModeStateQuiet" or "Quiet" => SentryModeState.Quiet,
        _ => SentryModeState.Unknown,
    };

    public static TeslaTelemetryMessage? TryParse(string json)
    {
        try
        {
            return JsonSerializer.Deserialize<TeslaTelemetryMessage>(json, JsonOptions);
        }
        catch
        {
            return null;
        }
    }

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
    };
}

public sealed class TelemetryDatum
{
    [JsonPropertyName("key")] public string Key { get; set; } = string.Empty;
    [JsonPropertyName("value")] public TelemetryValue? Value { get; set; }
}

public sealed class TelemetryValue
{
    [JsonPropertyName("stringValue")] public string? StringValue { get; set; }
    [JsonPropertyName("sentryModeStateValue")] public string? SentryModeStateValue { get; set; }
    [JsonPropertyName("boolValue")] public bool? BoolValue { get; set; }
    [JsonPropertyName("doubleValue")] public double? DoubleValue { get; set; }
    [JsonPropertyName("intValue")] public long? IntValue { get; set; }
}
