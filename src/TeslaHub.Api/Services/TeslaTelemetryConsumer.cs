using System.Text;
using NATS.Client.Core;
using NATS.Client.JetStream;
using NATS.Client.JetStream.Models;

namespace TeslaHub.Api.Services;

/// <summary>
/// Subscribes to the Tesla Fleet Telemetry NATS stream produced by the
/// 'fleet-telemetry' container, parses each message as a TeslaTelemetryMessage,
/// and forwards it to SecurityAlertService for alert detection and Telegram
/// fan-out.
///
/// Pull-based JetStream consumption with a per-instance durable name so the
/// stream survives TeslaHub restarts without losing messages (24h retention
/// configured on the stream).
///
/// Stays inactive when SECURITY_ALERTS_ENABLED != "true" so non-opted-in
/// users never see network traffic to NATS.
/// </summary>
public sealed class TeslaTelemetryConsumer : BackgroundService
{
    private const string StreamName = "TESLA_TELEMETRY";
    private const string SubjectPattern = "tesla.telemetry.v";
    private const string ConsumerName = "teslahub-api";

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IConfiguration _configuration;
    private readonly ILogger<TeslaTelemetryConsumer> _logger;

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

        var natsUrl = _configuration["NATS_URL"] ?? "nats://nats:4222";
        _logger.LogInformation("Telemetry consumer starting with NATS URL {Url}", natsUrl);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await RunOnceAsync(natsUrl, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Telemetry consumer crashed; reconnecting in 10s.");
                try { await Task.Delay(TimeSpan.FromSeconds(10), stoppingToken); }
                catch (OperationCanceledException) { break; }
            }
        }
    }

    private async Task RunOnceAsync(string natsUrl, CancellationToken cancellationToken)
    {
        var opts = new NatsOpts { Url = natsUrl, Name = "teslahub-api" };
        await using var nats = new NatsConnection(opts);
        var js = new NatsJSContext(nats);

        try
        {
            await js.GetStreamAsync(StreamName, cancellationToken: cancellationToken);
        }
        catch (NatsJSApiException)
        {
            await js.CreateStreamAsync(
                new StreamConfig(StreamName, new[] { "tesla.telemetry.>" })
                {
                    Retention = StreamConfigRetention.Limits,
                    MaxAge = TimeSpan.FromDays(1),
                    Storage = StreamConfigStorage.File,
                },
                cancellationToken: cancellationToken);
            _logger.LogInformation("Created NATS JetStream stream {Stream}", StreamName);
        }

        var consumer = await js.CreateOrUpdateConsumerAsync(StreamName, new ConsumerConfig
        {
            Name = ConsumerName,
            DurableName = ConsumerName,
            FilterSubject = SubjectPattern,
            DeliverPolicy = ConsumerConfigDeliverPolicy.New,
            AckPolicy = ConsumerConfigAckPolicy.Explicit,
            MaxAckPending = 100,
            AckWait = TimeSpan.FromSeconds(30),
        }, cancellationToken: cancellationToken);

        _logger.LogInformation("Telemetry consumer ready, listening on {Subject}", SubjectPattern);

        await foreach (var msg in consumer.ConsumeAsync<byte[]>(cancellationToken: cancellationToken))
        {
            try
            {
                var json = Encoding.UTF8.GetString(msg.Data ?? Array.Empty<byte>());
                var parsed = TeslaTelemetryMessage.TryParse(json);
                if (parsed is null)
                {
                    _logger.LogWarning("Could not parse telemetry payload: {Snippet}",
                        json.Length > 200 ? json[..200] + "…" : json);
                    await msg.AckAsync(cancellationToken: cancellationToken);
                    continue;
                }

                using var scope = _scopeFactory.CreateScope();
                var alerts = scope.ServiceProvider.GetRequiredService<SecurityAlertService>();
                await alerts.ProcessTelemetryAsync(parsed, cancellationToken);

                await msg.AckAsync(cancellationToken: cancellationToken);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to process telemetry message; nak'ing for retry.");
                await msg.NakAsync(cancellationToken: cancellationToken);
            }
        }
    }
}
