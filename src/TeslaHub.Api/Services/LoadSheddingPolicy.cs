using TeslaHub.Api.Models;

namespace TeslaHub.Api.Services;

public enum LoadSheddingDecisionKind
{
    Hold,
    Reduce,
    Raise,
    NoData,
}

public readonly record struct LoadSheddingDecision(
    LoadSheddingDecisionKind Kind,
    int? TargetAmps,
    string? Reason);

/// <summary>
/// Pure decision function: given the current profile, the runtime state
/// and the live house-power source, return what the engine should do.
/// Has zero side-effect — easy to unit-test without MQTT or DB.
/// </summary>
public interface ILoadSheddingPolicy
{
    LoadSheddingDecision Decide(
        LoadSheddingProfile profile,
        VehicleSheddingState state,
        HousePowerSource housePower,
        int observedAmps);
}

/// <summary>
/// V1 policy: two-state hysteresis (Steady at MaxAmps, Reduced at
/// TargetReducedAmps), with sliding-window guards on both transitions.
/// No PID, no continuous modulation. The two distinct windows + the
/// gap between high/low thresholds prevent oscillation.
/// </summary>
public sealed class SimpleHysteresisPolicy : ILoadSheddingPolicy
{
    public LoadSheddingDecision Decide(
        LoadSheddingProfile profile,
        VehicleSheddingState state,
        HousePowerSource housePower,
        int observedAmps)
    {
        if (!housePower.HasData)
            return new LoadSheddingDecision(LoadSheddingDecisionKind.NoData, null, "No MQTT samples yet");

        // Reduce: house apparent power has been above the high threshold
        // for the entire high-window, AND we still have headroom above
        // the reduced setpoint. Without the second test we'd command the
        // same value in a loop on every tick.
        if (housePower.AllAboveFor(
                profile.HighThresholdVa,
                TimeSpan.FromSeconds(profile.HighWindowSeconds),
                profile.MinSamplesInWindow)
            && observedAmps > profile.TargetReducedAmps)
        {
            return new LoadSheddingDecision(
                LoadSheddingDecisionKind.Reduce,
                profile.TargetReducedAmps,
                $"House >{profile.HighThresholdVa} VA for {profile.HighWindowSeconds}s");
        }

        // Raise: stable below the low threshold for the longer low-window,
        // and we are still under MaxAmps. The asymmetry between the two
        // windows is intentional: react fast on overload, restore slowly.
        if (housePower.AllBelowFor(
                profile.LowThresholdVa,
                TimeSpan.FromSeconds(profile.LowWindowSeconds),
                profile.MinSamplesInWindow)
            && observedAmps < profile.MaxAmps)
        {
            return new LoadSheddingDecision(
                LoadSheddingDecisionKind.Raise,
                profile.MaxAmps,
                $"House <{profile.LowThresholdVa} VA for {profile.LowWindowSeconds}s");
        }

        return new LoadSheddingDecision(LoadSheddingDecisionKind.Hold, null, null);
    }
}
