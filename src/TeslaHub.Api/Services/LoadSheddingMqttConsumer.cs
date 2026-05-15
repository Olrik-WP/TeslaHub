using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using MQTTnet;
using MQTTnet.Protocol;
using TeslaHub.Api.Data;

namespace TeslaHub.Api.Services;

/// <summary>
/// In-memory pub/sub used by the load-shedding endpoints to ask the
/// <see cref="LoadSheddingMqttConsumer"/> to drop its current MQTT
/// connection and re-resolve topic / JSON field from the database.
///
/// Avoids requiring the user to restart the container after editing
/// the MQTT source from the Settings panel.
/// </summary>
public sealed class LoadSheddingMqttSignal
{
    private CancellationTokenSource _cts = new();
    private readonly object _gate = new();

    public CancellationToken Token
    {
        get { lock (_gate) { return _cts.Token; } }
    }

    public void RequestRefresh()
    {
        CancellationTokenSource old;
        lock (_gate)
        {
            old = _cts;
            _cts = new CancellationTokenSource();
        }
        old.Cancel();
        old.Dispose();
    }
}

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
    private readonly LoadSheddingMqttSignal _signal;
    private readonly ILogger<LoadSheddingMqttConsumer> _logger;

    public LoadSheddingMqttConsumer(
        IServiceScopeFactory scopeFactory,
        IConfiguration configuration,
        HousePowerSource housePower,
        LoadSheddingMqttSignal signal,
        ILogger<LoadSheddingMqttConsumer> logger)
    {
        _scopeFactory = scopeFactory;
        _configuration = configuration;
        _housePower = housePower;
        _signal = signal;
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

        var port = int.TryParse(_configuration["MQTT_PORT"], out var p) ? p : 1883;
        var user = _configuration["MQTT_USER"] ?? string.Empty;
        var pass = _configuration["MQTT_PASSWORD"] ?? string.Empty;

        // Topic/field/scale are re-resolved at every connection attempt
        // so a profile edit from the UI takes effect on the next
        // reconnection (triggered by LoadSheddingMqttSignal.RequestRefresh()).
        while (!stoppingToken.IsCancellationRequested)
        {
            var resolved = await ResolveSourceAsync(stoppingToken);
            var topic = string.IsNullOrWhiteSpace(resolved.Topic) ? "zigbee2mqtt/Lixee" : resolved.Topic;
            var jsonField = string.IsNullOrWhiteSpace(resolved.Field) ? "apparent_power" : resolved.Field;
            var scale = resolved.Scale <= 0 ? 1.0 : resolved.Scale;

            // Combine the host stop token with the per-connection signal
            // so PUT /load-shedding/profiles/{id} can yank the connection
            // immediately and force a reload from DB on the next iteration.
            using var linked = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken, _signal.Token);

            try
            {
                _logger.LogInformation(
                    "Load-shedding consumer connecting (broker {Host}:{Port}, topic '{Topic}', field '{Field}', scale {Scale}).",
                    host, port, topic, jsonField, scale);
                await RunOnceAsync(host, port, user, pass, topic, jsonField, scale, linked.Token);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (OperationCanceledException)
            {
                // Refresh requested by the UI: loop back immediately.
                _logger.LogInformation("Load-shedding consumer received reload signal — reconnecting.");
                continue;
            }
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

    private readonly record struct ResolvedSource(string? Topic, string? Field, double Scale);

    private async Task<ResolvedSource> ResolveSourceAsync(CancellationToken cancellationToken)
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
                ? new ResolvedSource(null, null, 1.0)
                : new ResolvedSource(profile.MqttTopic, profile.PowerJsonField, profile.PowerScale);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to read load-shedding profile from DB on startup.");
            return new ResolvedSource(null, null, 1.0);
        }
    }

    private async Task RunOnceAsync(
        string host, int port, string user, string pass,
        string topic, string jsonField, double scale,
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
            try { ProcessMessage(e.ApplicationMessage, jsonField, scale); }
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

    private void ProcessMessage(MqttApplicationMessage message, string jsonField, double scale)
    {
        if (message.Payload.IsEmpty) return;
        var payload = Encoding.UTF8.GetString(message.Payload);

        try
        {
            using var doc = JsonDocument.Parse(payload);
            JsonElement prop;
            // Empty path means the payload IS already a scalar value
            // (P1 readers publish a single number on a leaf topic like
            // .../power_consumed/state, no wrapping object).
            if (string.IsNullOrWhiteSpace(jsonField))
                prop = doc.RootElement;
            else if (!TryResolvePath(doc.RootElement, jsonField, out prop))
                return;

            double? raw = prop.ValueKind switch
            {
                JsonValueKind.Number when prop.TryGetDouble(out var d) => d,
                JsonValueKind.String when double.TryParse(
                    prop.GetString(),
                    System.Globalization.NumberStyles.Float,
                    System.Globalization.CultureInfo.InvariantCulture,
                    out var s) => s,
                _ => null,
            };

            // We refuse negative readings (export to grid is irrelevant
            // for shedding) but accept any positive magnitude. The scale
            // multiplier converts source unit (e.g. kW from a P1 reader,
            // scale=1000) into the integer working unit used by the rest
            // of the pipeline.
            if (raw is null || raw < 0) return;
            var scaled = raw.Value * scale;
            _housePower.Add((int)Math.Round(scaled));
        }
        catch (JsonException)
        {
            // Malformed payload — drop quietly to avoid log spam.
        }
    }

    /// <summary>
    /// Walks a dot-notation path through a JSON document.
    /// "apparent_power" → root.apparent_power (ZLinky / generic).
    /// "em.total_act_power" → root.em.total_act_power (Shelly EM Gen2).
    /// "ENERGY.Power" → root.ENERGY.Power (Tasmota).
    /// "0.power" → root[0].power (array index segment).
    /// </summary>
    private static bool TryResolvePath(JsonElement root, string path, out JsonElement value)
    {
        value = root;
        if (string.IsNullOrWhiteSpace(path)) return false;

        foreach (var segment in path.Split('.'))
        {
            if (string.IsNullOrEmpty(segment)) return false;
            switch (value.ValueKind)
            {
                case JsonValueKind.Object:
                    if (!value.TryGetProperty(segment, out var next)) return false;
                    value = next;
                    break;
                case JsonValueKind.Array when int.TryParse(segment, out var idx) && idx >= 0 && idx < value.GetArrayLength():
                    value = value[idx];
                    break;
                default:
                    return false;
            }
        }
        return true;
    }
}
