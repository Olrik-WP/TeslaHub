using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using MQTTnet;
using MQTTnet.Protocol;
using TeslaHub.Api.Data;

namespace TeslaHub.Api.Services;

/// <summary>
/// Subscribes to the Zigbee2MQTT topic published by the smart-meter
/// device (typically a ZLinky TIC). Each message is a JSON object whose
/// <c>apparent_power</c> field carries the whole-house instantaneous
/// volt-amperes the load-shedding engine consumes.
///
/// Why a SEPARATE BackgroundService and broker connection (instead of
/// reusing <see cref="MqttLiveDataService"/> or
/// <see cref="TeslaTelemetryConsumer"/>):
///
///   * the topic is unrelated to TeslaMate / fleet-telemetry namespaces,
///   * the configurable topic + JSON field are per-profile data we'd
///     have to thread through unrelated services otherwise,
///   * isolating it keeps reconnect / failure semantics for each feed
///     independent (a Z2M outage must not silence Tesla telemetry).
///
/// The broker is shared (Mosquitto), credentials are read from the
/// existing <c>MQTT_*</c> env vars used by <see cref="MqttLiveDataService"/>.
///
/// Topic + JSON field are read from the FIRST enabled
/// <see cref="Models.LoadSheddingProfile"/> in the database. Re-read at
/// startup only — changing the topic from the UI requires an API
/// restart for now (a future improvement could publish a refresh signal
/// over an in-memory channel).
/// </summary>
public sealed class LoadSheddingMqttConsumer : BackgroundService
{
    private static readonly TimeSpan ReconnectBackoff = TimeSpan.FromSeconds(10);

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IConfiguration _configuration;
    private readonly HousePowerSource _housePower;
    private readonly ILogger<LoadSheddingMqttConsumer> _logger;

    public LoadSheddingMqttConsumer(
        IServiceScopeFactory scopeFactory,
        IConfiguration configuration,
        HousePowerSource housePower,
        ILogger<LoadSheddingMqttConsumer> logger)
    {
        _scopeFactory = scopeFactory;
        _configuration = configuration;
        _housePower = housePower;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var host = _configuration["MQTT_HOST"];
        if (string.IsNullOrWhiteSpace(host))
        {
            _logger.LogInformation("MQTT_HOST not configured — load-shedding MQTT consumer is idle.");
            return;
        }

        // Wait briefly so AppDbContext.Migrate() has finished (it runs
        // before app.Run(), but the BackgroundService starts in parallel).
        try { await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken); }
        catch (OperationCanceledException) { return; }

        // Always connect, even before any profile is saved. The consumer
        // is purely observational — feeding the live "house power" tile
        // in Settings is useful BEFORE the user enables anything, so they
        // can pick sensible thresholds based on their own peaks. We start
        // with the first persisted profile's topic+field if any, falling
        // back to the ZLinky-in-standard-TIC defaults otherwise.
        var (topic, jsonField) = await ResolveTopicAndFieldAsync(stoppingToken);
        topic = string.IsNullOrWhiteSpace(topic) ? "zigbee2mqtt/Lixee" : topic;
        jsonField = string.IsNullOrWhiteSpace(jsonField) ? "apparent_power" : jsonField;

        var port = int.TryParse(_configuration["MQTT_PORT"], out var p) ? p : 1883;
        var user = _configuration["MQTT_USER"] ?? string.Empty;
        var pass = _configuration["MQTT_PASSWORD"] ?? string.Empty;

        _logger.LogInformation(
            "Load-shedding consumer starting (broker {Host}:{Port}, topic '{Topic}', field '{Field}').",
            host, port, topic, jsonField);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await RunOnceAsync(host, port, user, pass, topic, jsonField, stoppingToken);
            }
            catch (OperationCanceledException) { break; }
            catch (Exception ex)
            {
                _housePower.MqttConnected = false;
                _logger.LogError(ex, "Load-shedding MQTT consumer crashed; reconnecting in {Backoff}.", ReconnectBackoff);
                try { await Task.Delay(ReconnectBackoff, stoppingToken); }
                catch (OperationCanceledException) { break; }
            }
        }

        _housePower.MqttConnected = false;
    }

    private async Task<(string? topic, string? field)> ResolveTopicAndFieldAsync(CancellationToken cancellationToken)
    {
        try
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            // ANY profile, regardless of Enabled / DryRun: we observe
            // the meter for the live UI tile and so the user can later
            // tune thresholds against real samples before activating.
            var profile = await db.LoadSheddingProfiles
                .OrderBy(p => p.Id)
                .FirstOrDefaultAsync(cancellationToken);

            return profile is null
                ? (null, null)
                : (profile.MqttTopic, profile.PowerJsonField);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to read load-shedding profile from DB on startup.");
            return (null, null);
        }
    }

    private async Task RunOnceAsync(
        string host, int port, string user, string pass,
        string topic, string jsonField,
        CancellationToken cancellationToken)
    {
        var factory = new MqttClientFactory();
        using var client = factory.CreateMqttClient();

        var optionsBuilder = new MqttClientOptionsBuilder()
            .WithTcpServer(host, port)
            .WithClientId($"teslahub-shed-{Environment.MachineName}-{Guid.NewGuid():N}"[..40])
            .WithCleanSession(true);

        if (!string.IsNullOrEmpty(user))
            optionsBuilder.WithCredentials(user, pass);

        client.ApplicationMessageReceivedAsync += e =>
        {
            try { ProcessMessage(e.ApplicationMessage, jsonField); }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to process load-shedding MQTT message on topic {Topic}", e.ApplicationMessage.Topic);
            }
            return Task.CompletedTask;
        };

        client.DisconnectedAsync += e =>
        {
            _housePower.MqttConnected = false;
            if (!cancellationToken.IsCancellationRequested)
                _logger.LogWarning("Load-shedding MQTT disconnected: {Reason}", e.Reason);
            return Task.CompletedTask;
        };

        await client.ConnectAsync(optionsBuilder.Build(), cancellationToken);
        _housePower.MqttConnected = true;
        _logger.LogInformation("Load-shedding MQTT connected — subscribing to '{Topic}'", topic);

        var subOptions = new MqttClientSubscribeOptionsBuilder()
            .WithTopicFilter(topic, MqttQualityOfServiceLevel.AtMostOnce)
            .Build();
        await client.SubscribeAsync(subOptions, cancellationToken);

        while (client.IsConnected && !cancellationToken.IsCancellationRequested)
        {
            await Task.Delay(5000, cancellationToken);
        }

        _housePower.MqttConnected = false;
    }

    private void ProcessMessage(MqttApplicationMessage message, string jsonField)
    {
        if (message.Payload.IsEmpty) return;
        var payload = Encoding.UTF8.GetString(message.Payload);

        try
        {
            using var doc = JsonDocument.Parse(payload);
            if (!doc.RootElement.TryGetProperty(jsonField, out var prop))
                return;

            int? va = prop.ValueKind switch
            {
                JsonValueKind.Number when prop.TryGetInt32(out var i) => i,
                JsonValueKind.Number when prop.TryGetDouble(out var d) => (int)Math.Round(d),
                JsonValueKind.String when int.TryParse(prop.GetString(), out var s) => s,
                _ => null,
            };

            if (va is null || va < 0) return;
            _housePower.Add(va.Value);
        }
        catch (JsonException)
        {
            // Malformed payload from Z2M — drop quietly to avoid log spam.
        }
    }
}
