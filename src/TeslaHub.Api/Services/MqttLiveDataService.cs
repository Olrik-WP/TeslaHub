using System.Collections.Concurrent;
using System.Text;
using MQTTnet;
using MQTTnet.Packets;
using MQTTnet.Protocol;

namespace TeslaHub.Api.Services;

public class MqttLiveData
{
    public bool? Locked { get; set; }
    public bool? DoorsOpen { get; set; }
    public bool? DriverFrontDoorOpen { get; set; }
    public bool? DriverRearDoorOpen { get; set; }
    public bool? PassengerFrontDoorOpen { get; set; }
    public bool? PassengerRearDoorOpen { get; set; }
    public bool? TrunkOpen { get; set; }
    public bool? FrunkOpen { get; set; }
    public bool? WindowsOpen { get; set; }
    public bool? SentryMode { get; set; }
    public bool? IsUserPresent { get; set; }
    public bool? TpmsSoftWarningFl { get; set; }
    public bool? TpmsSoftWarningFr { get; set; }
    public bool? TpmsSoftWarningRl { get; set; }
    public bool? TpmsSoftWarningRr { get; set; }
    public string? ClimateKeeperMode { get; set; }
    public bool? IsPreconditioning { get; set; }
    public DateTime LastUpdated { get; set; } = DateTime.UtcNow;
}

public class MqttLiveDataService : BackgroundService
{
    private readonly ILogger<MqttLiveDataService> _logger;
    private readonly IConfiguration _config;
    private readonly ConcurrentDictionary<int, MqttLiveData> _liveData = new();
    private IMqttClient? _client;

    private static readonly HashSet<string> TrackedKeys = new(StringComparer.OrdinalIgnoreCase)
    {
        "locked", "doors_open",
        "driver_front_door_open", "driver_rear_door_open",
        "passenger_front_door_open", "passenger_rear_door_open",
        "trunk_open", "frunk_open", "windows_open",
        "sentry_mode", "is_user_present",
        "tpms_soft_warning_fl", "tpms_soft_warning_fr",
        "tpms_soft_warning_rl", "tpms_soft_warning_rr",
        "climate_keeper_mode", "is_preconditioning"
    };

    public bool IsConnected => _client?.IsConnected == true;

    public MqttLiveDataService(ILogger<MqttLiveDataService> logger, IConfiguration config)
    {
        _logger = logger;
        _config = config;
    }

    public MqttLiveData? GetLiveData(int carId)
    {
        return _liveData.TryGetValue(carId, out var data) ? data : null;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var host = _config["MQTT_HOST"];
        if (string.IsNullOrEmpty(host))
        {
            _logger.LogInformation("MQTT_HOST not configured — MQTT live data disabled");
            return;
        }

        var port = int.TryParse(_config["MQTT_PORT"], out var p) ? p : 1883;
        var user = _config["MQTT_USER"] ?? "";
        var pass = _config["MQTT_PASSWORD"] ?? "";
        var ns = _config["MQTT_NAMESPACE"] ?? "";

        var topicPrefix = string.IsNullOrEmpty(ns) ? "teslamate" : $"teslamate/{ns}";
        var topicFilter = $"{topicPrefix}/cars/#";

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var factory = new MqttClientFactory();
                _client = factory.CreateMqttClient();

                var optionsBuilder = new MqttClientOptionsBuilder()
                    .WithTcpServer(host, port)
                    .WithClientId($"teslahub-{Environment.MachineName}-{Guid.NewGuid():N}"[..40])
                    .WithCleanSession(true);

                if (!string.IsNullOrEmpty(user))
                    optionsBuilder.WithCredentials(user, pass);

                _client.ApplicationMessageReceivedAsync += e =>
                {
                    ProcessMessage(e.ApplicationMessage, topicPrefix);
                    return Task.CompletedTask;
                };

                _client.DisconnectedAsync += e =>
                {
                    if (!stoppingToken.IsCancellationRequested)
                        _logger.LogWarning("MQTT disconnected: {Reason}", e.Reason);
                    return Task.CompletedTask;
                };

                _logger.LogInformation("Connecting to MQTT broker at {Host}:{Port}...", host, port);
                await _client.ConnectAsync(optionsBuilder.Build(), stoppingToken);
                _logger.LogInformation("MQTT connected — subscribing to {Topic}", topicFilter);

                var subOptions = new MqttClientSubscribeOptionsBuilder()
                    .WithTopicFilter(topicFilter, MqttQualityOfServiceLevel.AtLeastOnce)
                    .Build();
                await _client.SubscribeAsync(subOptions, stoppingToken);

                while (_client.IsConnected && !stoppingToken.IsCancellationRequested)
                {
                    await Task.Delay(5000, stoppingToken);
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "MQTT error — reconnecting in 10s");
            }
            finally
            {
                if (_client?.IsConnected == true)
                {
                    try { await _client.DisconnectAsync(); } catch { }
                }
                _client?.Dispose();
                _client = null;
            }

            if (!stoppingToken.IsCancellationRequested)
                await Task.Delay(10_000, stoppingToken);
        }
    }

    private void ProcessMessage(MqttApplicationMessage msg, string topicPrefix)
    {
        var topic = msg.Topic;
        if (string.IsNullOrEmpty(topic)) return;

        // topic = "teslamate/cars/{carId}/{key}" or "teslamate/{ns}/cars/{carId}/{key}"
        var prefix = $"{topicPrefix}/cars/";
        if (!topic.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) return;

        var remainder = topic[prefix.Length..];
        var slashIdx = remainder.IndexOf('/');
        if (slashIdx <= 0) return;

        if (!int.TryParse(remainder[..slashIdx], out var carId)) return;
        var key = remainder[(slashIdx + 1)..];

        if (!TrackedKeys.Contains(key)) return;

        var payload = msg.Payload;
        var value = payload.Length > 0
            ? Encoding.UTF8.GetString(payload)
            : "";

        var data = _liveData.GetOrAdd(carId, _ => new MqttLiveData());
        ApplyValue(data, key, value);
        data.LastUpdated = DateTime.UtcNow;
    }

    private static void ApplyValue(MqttLiveData data, string key, string value)
    {
        var boolVal = value.Equals("true", StringComparison.OrdinalIgnoreCase) ? true
                    : value.Equals("false", StringComparison.OrdinalIgnoreCase) ? false
                    : (bool?)null;

        switch (key)
        {
            case "locked":                    data.Locked = boolVal; break;
            case "doors_open":                data.DoorsOpen = boolVal; break;
            case "driver_front_door_open":    data.DriverFrontDoorOpen = boolVal; break;
            case "driver_rear_door_open":     data.DriverRearDoorOpen = boolVal; break;
            case "passenger_front_door_open": data.PassengerFrontDoorOpen = boolVal; break;
            case "passenger_rear_door_open":  data.PassengerRearDoorOpen = boolVal; break;
            case "trunk_open":                data.TrunkOpen = boolVal; break;
            case "frunk_open":          data.FrunkOpen = boolVal; break;
            case "windows_open":        data.WindowsOpen = boolVal; break;
            case "sentry_mode":         data.SentryMode = boolVal; break;
            case "is_user_present":     data.IsUserPresent = boolVal; break;
            case "tpms_soft_warning_fl": data.TpmsSoftWarningFl = boolVal; break;
            case "tpms_soft_warning_fr": data.TpmsSoftWarningFr = boolVal; break;
            case "tpms_soft_warning_rl": data.TpmsSoftWarningRl = boolVal; break;
            case "tpms_soft_warning_rr": data.TpmsSoftWarningRr = boolVal; break;
            case "climate_keeper_mode":  data.ClimateKeeperMode = value; break;
            case "is_preconditioning":   data.IsPreconditioning = boolVal; break;
        }
    }

    public override async Task StopAsync(CancellationToken cancellationToken)
    {
        if (_client?.IsConnected == true)
        {
            try { await _client.DisconnectAsync(); } catch { }
        }
        await base.StopAsync(cancellationToken);
    }
}
