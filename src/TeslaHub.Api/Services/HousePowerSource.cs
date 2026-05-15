using System.Collections.Concurrent;

namespace TeslaHub.Api.Services;

/// <summary>
/// Single sample of whole-house apparent power (volt-amperes), tagged
/// with the moment the API container received it. We deliberately do
/// NOT use the timestamp embedded in the meter payload (`current_date`
/// in the ZLinky payload) because Z2M coalesces messages and the field
/// is not always refreshed per message.
/// </summary>
public readonly record struct HousePowerSample(int Va, DateTime At);

/// <summary>
/// Singleton in-memory house-power feed. Producer:
/// <see cref="LoadSheddingMqttConsumer"/>. Consumers: the load-shedding
/// engine and the SettingsLoadSheddingPanel live status endpoint.
///
/// Stores a bounded sliding window (max 30 minutes) so the engine can
/// query "all samples above X for the last N seconds" cheaply, and the
/// UI can show "samples in the last 60s" without separate plumbing.
///
/// De-duplication: ZLinky publishes redundant messages whenever any
/// payload field changes (energy index, voltage, current...) even if
/// `apparent_power` itself is unchanged. We drop a sample when its VA
/// value AND its arrival time match the previous one within
/// <see cref="DedupSameValueWindow"/>, otherwise the sliding window
/// fills with synthetic duplicates and biases the "min samples" guard.
/// </summary>
public sealed class HousePowerSource
{
    private static readonly TimeSpan WindowRetention = TimeSpan.FromMinutes(30);
    private static readonly TimeSpan DedupSameValueWindow = TimeSpan.FromMilliseconds(2000);

    private readonly object _gate = new();
    private readonly LinkedList<HousePowerSample> _samples = new();

    /// <summary>True once we have received at least one sample since boot.</summary>
    public bool HasData { get; private set; }

    /// <summary>True when the underlying MQTT consumer is connected to the broker.</summary>
    public bool MqttConnected { get; set; }

    public HousePowerSample? Latest
    {
        get
        {
            lock (_gate)
            {
                return _samples.Count == 0 ? null : _samples.Last!.Value;
            }
        }
    }

    /// <summary>Number of samples received in the last 60 s (after dedup).</summary>
    public int RecentSampleCount(TimeSpan window)
    {
        var threshold = DateTime.UtcNow - window;
        lock (_gate)
        {
            var n = 0;
            for (var node = _samples.Last; node is not null; node = node.Previous)
            {
                if (node.Value.At < threshold) break;
                n++;
            }
            return n;
        }
    }

    /// <summary>
    /// Returns true when EVERY sample in the last <paramref name="window"/>
    /// is strictly above <paramref name="thresholdVa"/> AND there are at
    /// least <paramref name="minSamples"/> samples in the window. Used by
    /// the engine for the "reduce" trigger.
    /// </summary>
    public bool AllAboveFor(int thresholdVa, TimeSpan window, int minSamples)
    {
        return EvaluateWindow(window, minSamples, sample => sample.Va > thresholdVa);
    }

    /// <summary>Mirror of <see cref="AllAboveFor"/> for the "raise" trigger.</summary>
    public bool AllBelowFor(int thresholdVa, TimeSpan window, int minSamples)
    {
        return EvaluateWindow(window, minSamples, sample => sample.Va < thresholdVa);
    }

    public void Add(int va)
    {
        var now = DateTime.UtcNow;
        lock (_gate)
        {
            // Dedup: same value arriving within the dedup window is
            // treated as a Z2M echo of the previous payload, not a new
            // measurement. We DO refresh the latest timestamp so the
            // "MQTT looks alive" indicator stays green.
            if (_samples.Last is { Value.Va: var lastVa } lastNode
                && lastVa == va
                && now - lastNode.Value.At < DedupSameValueWindow)
            {
                return;
            }

            _samples.AddLast(new HousePowerSample(va, now));
            HasData = true;

            // Trim anything older than the retention window. Bounded
            // O(k) where k = number of expired samples per insertion,
            // amortised O(1) under steady state.
            var oldest = now - WindowRetention;
            while (_samples.First is { Value.At: var firstAt } && firstAt < oldest)
                _samples.RemoveFirst();
        }
    }

    private bool EvaluateWindow(TimeSpan window, int minSamples, Func<HousePowerSample, bool> predicate)
    {
        var threshold = DateTime.UtcNow - window;
        lock (_gate)
        {
            var count = 0;
            for (var node = _samples.Last; node is not null; node = node.Previous)
            {
                if (node.Value.At < threshold) break;
                if (!predicate(node.Value)) return false;
                count++;
            }
            return count >= minSamples;
        }
    }
}

/// <summary>
/// Per-vehicle in-memory state machine + quota tracker for the
/// load-shedding engine. Lives in a singleton dictionary so we don't
/// hit the DB on every tick.
/// </summary>
public sealed class VehicleSheddingState
{
    public string Phase { get; set; } = "Steady"; // Steady | Reduced | NoData
    public int? LastAppliedAmps { get; set; }
    public DateTimeOffset? LastCommandAt { get; set; }
    public DateTimeOffset? CooldownUntil { get; set; }

    /// <summary>UTC-ordered command timestamps used by the rolling-window quotas.</summary>
    public ConcurrentQueue<DateTimeOffset> RecentCommandTimes { get; } = new();

    public int CountWithin(TimeSpan window)
    {
        var threshold = DateTimeOffset.UtcNow - window;
        var n = 0;
        foreach (var t in RecentCommandTimes)
            if (t >= threshold) n++;
        return n;
    }

    public void TrimQuotaWindows()
    {
        var oldest = DateTimeOffset.UtcNow - TimeSpan.FromDays(1);
        while (RecentCommandTimes.TryPeek(out var head) && head < oldest)
            RecentCommandTimes.TryDequeue(out _);
    }
}
