using System.Collections.Concurrent;
using System.Text;
using MQTTnet;
using MQTTnet.Packets;
using MQTTnet.Protocol;

namespace TeslaHub.Api.Services;

/// <summary>
/// Subscribes to the Tesla Fleet Telemetry MQTT stream produced by the
/// 'fleet-telemetry' container, accumulates one signal per topic into
/// per-VIN telemetry messages, and forwards them to SecurityAlertService
/// for alert detection and Telegram fan-out.
///
/// Topic layout published by Tesla Fleet Telemetry (configured via
/// fleet-telemetry/config.json on the host):
///
///   {topic_base}/{VIN}/v/{field}              — vehicle signals (one per topic)
///   {topic_base}/{VIN}/alerts/{name}/current  — current alert state
///
/// Field values are JSON-encoded scalars (numbers, booleans, strings).
/// We coalesce signals of interest (SentryMode, Locked, DoorState) into a
/// TeslaTelemetryMessage shape so the existing detection pipeline keeps
/// working unchanged.
///
/// Stays inactive when SECURITY_ALERTS_ENABLED != "true".
/// </summary>
public sealed class TeslaTelemetryConsumer : BackgroundService
{
    private static readonly TimeSpan ReconnectBackoff = TimeSpan.FromSeconds(10);

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IConfiguration _configuration;
    private readonly ILogger<TeslaTelemetryConsumer> _logger;
    private readonly ConcurrentDictionary<string, VehicleSignalState> _state = new();

    public TeslaTelemetryConsumer(
        IServiceScopeFactory scopeFactory,
        IConfiguration configuration,
        ILogger<TeslaTelemetryConsumer> logger)
    {
        _scopeFactory = scopeFactory;
        _configuration = configuration;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var enabled = string.Equals(_configuration["SECURITY_ALERTS_ENABLED"], "true",
            StringComparison.OrdinalIgnoreCase);
        if (!enabled)
        {
            _logger.LogInformation("Security alerts disabled (SECURITY_ALERTS_ENABLED!=true). Telemetry consumer is idle.");
            return;
        }

        var host = _configuration["TELEMETRY_MQTT_HOST"] ?? _configuration["MQTT_HOST"];
        if (string.IsNullOrWhiteSpace(host))
        {
            _logger.LogWarning("TELEMETRY_MQTT_HOST not set — telemetry consumer cannot start.");
            return;
        }

        var port = int.TryParse(_configuration["TELEMETRY_MQTT_PORT"], out var p) ? p : 1883;
        var user = _configuration["TELEMETRY_MQTT_USER"] ?? "";
        var pass = _configuration["TELEMETRY_MQTT_PASSWORD"] ?? "";
        var topicBase = _configuration["TELEMETRY_MQTT_TOPIC_BASE"] ?? "telemetry";
        var topicFilter = $"{topicBase}/+/v/+";
        var alertsFilter = $"{topicBase}/+/alerts/+/current";

        _logger.LogInformation("Telemetry consumer starting (broker {Host}:{Port}, base topic '{TopicBase}')",
            host, port, topicBase);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await RunOnceAsync(host, port, user, pass, topicBase, topicFilter, alertsFilter, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Telemetry consumer crashed; reconnecting in {Backoff}.", ReconnectBackoff);
                try { await Task.Delay(ReconnectBackoff, stoppingToken); }
                catch (OperationCanceledException) { break; }
            }
        }
    }

    private async Task RunOnceAsync(
        string host, int port, string user, string pass,
        string topicBase, string topicFilter, string alertsFilter,
        CancellationToken cancellationToken)
    {
        var factory = new MqttClientFactory();
        using var client = factory.CreateMqttClient();

        var optionsBuilder = new MqttClientOptionsBuilder()
            .WithTcpServer(host, port)
            .WithClientId($"teslahub-telemetry-{Environment.MachineName}-{Guid.NewGuid():N}"[..40])
            .WithCleanSession(true);

        if (!string.IsNullOrEmpty(user))
            optionsBuilder.WithCredentials(user, pass);

        client.ApplicationMessageReceivedAsync += async e =>
        {
            try
            {
                await HandleMessageAsync(e.ApplicationMessage, topicBase, cancellationToken);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to process telemetry message on topic {Topic}", e.ApplicationMessage.Topic);
            }
        };

        client.DisconnectedAsync += e =>
        {
            if (!cancellationToken.IsCancellationRequested)
                _logger.LogWarning("Telemetry MQTT disconnected: {Reason}", e.Reason);
            return Task.CompletedTask;
        };

        await client.ConnectAsync(optionsBuilder.Build(), cancellationToken);
        _logger.LogInformation("Telemetry MQTT connected — subscribing to '{Topic}' and '{Alerts}'", topicFilter, alertsFilter);

        var subOptions = new MqttClientSubscribeOptionsBuilder()
            .WithTopicFilter(topicFilter, MqttQualityOfServiceLevel.AtLeastOnce)
            .WithTopicFilter(alertsFilter, MqttQualityOfServiceLevel.AtLeastOnce)
            .Build();
        await client.SubscribeAsync(subOptions, cancellationToken);

        while (client.IsConnected && !cancellationToken.IsCancellationRequested)
        {
            await Task.Delay(5000, cancellationToken);
        }
    }

    private async Task HandleMessageAsync(MqttApplicationMessage message, string topicBase, CancellationToken cancellationToken)
    {
        var topic = message.Topic;
        if (!topic.StartsWith(topicBase + "/", StringComparison.OrdinalIgnoreCase))
            return;

        var rest = topic[(topicBase.Length + 1)..].Split('/');
        if (rest.Length < 3) return;

        var vin = rest[0];
        var category = rest[1];
        var raw = message.Payload.IsEmpty ? string.Empty : Encoding.UTF8.GetString(message.Payload);

        if (string.Equals(category, "v", StringComparison.OrdinalIgnoreCase))
        {
            var field = rest[2];
            HandleSignal(vin, field, raw, out var snapshot);
            if (snapshot is not null)
                await DispatchAsync(snapshot, cancellationToken);
            return;
        }

        if (string.Equals(category, "alerts", StringComparison.OrdinalIgnoreCase) && rest.Length >= 4)
        {
            var alertName = rest[2];
            var leaf = rest[3];
            if (!string.Equals(leaf, "current", StringComparison.OrdinalIgnoreCase))
                return;

            await DispatchAsync(new TeslaTelemetryMessage
            {
                Vin = vin,
                CreatedAt = DateTime.UtcNow.ToString("o"),
                Data = new()
                {
                    new TelemetryDatum { Key = alertName, Value = new TelemetryValue { StringValue = raw } },
                },
            }, cancellationToken);
        }
    }

    private void HandleSignal(string vin, string field, string raw, out TeslaTelemetryMessage? snapshot)
    {
        snapshot = null;
        var state = _state.GetOrAdd(vin, _ => new VehicleSignalState());

        switch (field)
        {
            case "SentryMode":
                state.SentryMode = TrimQuotes(raw);
                snapshot = state.ToTelemetryMessage(vin);
                break;
            case "Locked":
                state.Locked = ParseBool(raw);
                snapshot = state.ToTelemetryMessage(vin);
                break;
            case "DoorState":
                state.DoorState = TrimQuotes(raw);
                snapshot = state.ToTelemetryMessage(vin);
                break;
            default:
                return;
        }
    }

    private async Task DispatchAsync(TeslaTelemetryMessage message, CancellationToken cancellationToken)
    {
        using var scope = _scopeFactory.CreateScope();
        var alerts = scope.ServiceProvider.GetRequiredService<SecurityAlertService>();
        await alerts.ProcessTelemetryAsync(message, cancellationToken);
    }

    private static string TrimQuotes(string raw) =>
        raw.Length >= 2 && raw[0] == '"' && raw[^1] == '"' ? raw[1..^1] : raw;

    private static bool? ParseBool(string raw) => TrimQuotes(raw).ToLowerInvariant() switch
    {
        "true" => true,
        "false" => false,
        _ => null,
    };

    private sealed class VehicleSignalState
    {
        public string? SentryMode { get; set; }
        public bool? Locked { get; set; }
        public string? DoorState { get; set; }

        public TeslaTelemetryMessage ToTelemetryMessage(string vin)
        {
            var data = new List<TelemetryDatum>();
            if (SentryMode is not null)
                data.Add(new TelemetryDatum { Key = "SentryMode", Value = new TelemetryValue { StringValue = SentryMode } });
            if (Locked is bool l)
                data.Add(new TelemetryDatum { Key = "Locked", Value = new TelemetryValue { BoolValue = l } });
            if (DoorState is not null)
                data.Add(new TelemetryDatum { Key = "DoorState", Value = new TelemetryValue { StringValue = DoorState } });

            return new TeslaTelemetryMessage
            {
                Vin = vin,
                CreatedAt = DateTime.UtcNow.ToString("o"),
                Data = data,
            };
        }
    }
}
