using System.Collections.Concurrent;
using System.Text;
using System.Text.Json;
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
    public double? TpmsPressureFl { get; set; }
    public double? TpmsPressureFr { get; set; }
    public double? TpmsPressureRl { get; set; }
    public double? TpmsPressureRr { get; set; }
    public bool? TpmsSoftWarningFl { get; set; }
    public bool? TpmsSoftWarningFr { get; set; }
    public bool? TpmsSoftWarningRl { get; set; }
    public bool? TpmsSoftWarningRr { get; set; }
    public string? ClimateKeeperMode { get; set; }
    public bool? IsPreconditioning { get; set; }
    public bool? IsClimateOn { get; set; }
    // Front / rear defrosters: TeslaMate stores these in the `positions`
    // table but does NOT publish them on its MQTT topics, so the only
    // way they show up here is via OverlayFromFleetSnapshot below. The
    // Home page derives `defrostActive` from these two booleans, so we
    // need them in the merged VehicleStatus or the "Dégivrage" quick-
    // action button would flicker back to off the moment the Fleet
    // force-refresh re-runs (which invalidates the ['vehicle'] cache).
    public bool? IsFrontDefrosterOn { get; set; }
    public bool? IsRearDefrosterOn { get; set; }
    // Tesla's `defrost_mode` (0 = off, 2 = max). Only `2` means the user
    // actively engaged "set_preconditioning_max" — the per-defroster
    // booleans above also flip true when the HVAC is merely warming the
    // cabin, so the Home quick-action pill must read this field instead
    // (mirrors ClimateCard's `isMaxDefrost` logic on the Control page).
    // Populated exclusively by OverlayFromFleetSnapshot — TeslaMate's
    // MQTT firehose does not expose `defrost_mode`.
    public int? DefrostMode { get; set; }
    public bool? ChargePortDoorOpen { get; set; }
    public bool? PluggedIn { get; set; }

    public int? BatteryLevel { get; set; }
    public int? UsableBatteryLevel { get; set; }
    public double? RatedBatteryRangeKm { get; set; }
    public double? IdealBatteryRangeKm { get; set; }
    public double? Latitude { get; set; }
    public double? Longitude { get; set; }
    public double? InsideTemp { get; set; }
    public double? OutsideTemp { get; set; }
    public double? Odometer { get; set; }
    public int? Speed { get; set; }
    public int? Power { get; set; }
    public double? DriverTempSetting { get; set; }
    public double? PassengerTempSetting { get; set; }
    public string? State { get; set; }

    // Charging live data
    public string? ChargingState { get; set; }
    public double? ChargeEnergyAdded { get; set; }
    public double? ChargerPower { get; set; }
    public int? ChargerVoltage { get; set; }
    public double? ChargerActualCurrent { get; set; }
    public int? ChargeLimitSoc { get; set; }
    public double? TimeToFullCharge { get; set; }
    public double? EstBatteryRangeKm { get; set; }

    // Driving live data
    public string? ShiftState { get; set; }
    public int? Heading { get; set; }
    public int? Elevation { get; set; }
    public string? Geofence { get; set; }

    // Active navigation route (parsed from teslamate/cars/{id}/active_route JSON blob).
    // All fields null when no active route or when the payload is { "error": "..." }.
    public string? ActiveRouteDestination { get; set; }
    public double? ActiveRouteEnergyAtArrival { get; set; }
    public double? ActiveRouteMilesToArrival { get; set; }
    public double? ActiveRouteMinutesToArrival { get; set; }
    public double? ActiveRouteTrafficMinutesDelay { get; set; }
    public double? ActiveRouteLatitude { get; set; }
    public double? ActiveRouteLongitude { get; set; }
    public string? ActiveRouteError { get; set; }

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
        "tpms_pressure_fl", "tpms_pressure_fr",
        "tpms_pressure_rl", "tpms_pressure_rr",
        "tpms_soft_warning_fl", "tpms_soft_warning_fr",
        "tpms_soft_warning_rl", "tpms_soft_warning_rr",
        "climate_keeper_mode", "is_preconditioning", "is_climate_on",
        "charge_port_door_open", "plugged_in",
        "battery_level", "usable_battery_level",
        "rated_battery_range_km", "ideal_battery_range_km",
        "latitude", "longitude",
        "inside_temp", "outside_temp",
        "odometer", "speed", "power",
        "driver_temp_setting", "passenger_temp_setting",
        "state",
        // Charging live
        "charging_state", "charge_energy_added", "charger_power",
        "charger_voltage", "charger_actual_current",
        "charge_limit_soc", "time_to_full_charge",
        "est_battery_range_km",
        // Driving live
        "shift_state", "heading", "elevation", "geofence",
        // Navigation
        "active_route"
    };

    public event Action<int, MqttLiveData>? OnLiveDataChanged;

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

    /// <summary>
    /// Overlay the live cache with fields parsed from a fresh Fleet API
    /// <c>vehicle_data</c> response. Tesla command endpoints return only
    /// <c>{ result: true }</c> — they never echo the post-command state.
    /// After we force a <c>vehicle_data</c> refresh, this method projects
    /// the new <c>vehicle_state</c> / <c>climate_state</c> / <c>charge_state</c>
    /// blobs onto <see cref="MqttLiveData"/> so the Home page reflects the
    /// command result immediately, without waiting for TeslaMate's next
    /// Owner-API poll (which can lag 30-60s).
    /// </summary>
    /// <remarks>
    /// JSON keys follow the Fleet API contract documented at
    /// https://developer.tesla.com/docs/fleet-api/endpoints/vehicle-endpoints#vehicle-data
    /// — any field we don't recognise is silently ignored to stay forward
    /// compatible with Tesla's habit of adding fields without notice.
    /// </remarks>
    public void OverlayFromFleetSnapshot(
        int carId,
        string? vehicleStateJson,
        string? climateStateJson,
        string? chargeStateJson)
    {
        var data = _liveData.GetOrAdd(carId, _ => new MqttLiveData());
        var changed = false;

        if (!string.IsNullOrWhiteSpace(vehicleStateJson))
            changed |= ApplyVehicleState(data, vehicleStateJson);
        if (!string.IsNullOrWhiteSpace(climateStateJson))
            changed |= ApplyClimateState(data, climateStateJson);
        if (!string.IsNullOrWhiteSpace(chargeStateJson))
            changed |= ApplyChargeState(data, chargeStateJson);

        if (!changed) return;

        data.LastUpdated = DateTime.UtcNow;
        OnLiveDataChanged?.Invoke(carId, data);
    }

    private static bool ApplyVehicleState(MqttLiveData data, string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object) return false;

            var changed = false;
            changed |= AssignBool(root, "locked", v => data.Locked = v);
            changed |= AssignBool(root, "sentry_mode", v => data.SentryMode = v);
            changed |= AssignBool(root, "is_user_present", v => data.IsUserPresent = v);

            // Door sensors: Fleet API exposes them as integers (0/1) per corner.
            var df = TryGetInt(root, "df");
            var dr = TryGetInt(root, "dr");
            var pf = TryGetInt(root, "pf");
            var pr = TryGetInt(root, "pr");
            if (df.HasValue) { data.DriverFrontDoorOpen = df.Value != 0; changed = true; }
            if (dr.HasValue) { data.DriverRearDoorOpen = dr.Value != 0; changed = true; }
            if (pf.HasValue) { data.PassengerFrontDoorOpen = pf.Value != 0; changed = true; }
            if (pr.HasValue) { data.PassengerRearDoorOpen = pr.Value != 0; changed = true; }
            if (df.HasValue && dr.HasValue && pf.HasValue && pr.HasValue)
            {
                data.DoorsOpen = (df.Value | dr.Value | pf.Value | pr.Value) != 0;
                changed = true;
            }

            var trunk = TryGetInt(root, "rt");
            var frunk = TryGetInt(root, "ft");
            if (trunk.HasValue) { data.TrunkOpen = trunk.Value != 0; changed = true; }
            if (frunk.HasValue) { data.FrunkOpen = frunk.Value != 0; changed = true; }

            // Windows: fd_window / fp_window / rd_window / rp_window are 0=closed, 1=open.
            var fdw = TryGetInt(root, "fd_window");
            var fpw = TryGetInt(root, "fp_window");
            var rdw = TryGetInt(root, "rd_window");
            var rpw = TryGetInt(root, "rp_window");
            if (fdw.HasValue || fpw.HasValue || rdw.HasValue || rpw.HasValue)
            {
                data.WindowsOpen = (fdw ?? 0) + (fpw ?? 0) + (rdw ?? 0) + (rpw ?? 0) > 0;
                changed = true;
            }

            var odo = TryGetDouble(root, "odometer");
            if (odo.HasValue)
            {
                // Fleet API reports miles → TeslaMate uses kilometres in cache.
                data.Odometer = odo.Value * 1.609344;
                changed = true;
            }

            return changed;
        }
        catch (JsonException)
        {
            return false;
        }
    }

    private static bool ApplyClimateState(MqttLiveData data, string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object) return false;

            var changed = false;
            changed |= AssignBool(root, "is_climate_on", v => data.IsClimateOn = v);
            changed |= AssignBool(root, "is_preconditioning", v => data.IsPreconditioning = v);
            changed |= AssignBool(root, "is_front_defroster_on", v => data.IsFrontDefrosterOn = v);
            changed |= AssignBool(root, "is_rear_defroster_on", v => data.IsRearDefrosterOn = v);
            changed |= AssignDouble(root, "driver_temp_setting", v => data.DriverTempSetting = v);
            changed |= AssignDouble(root, "passenger_temp_setting", v => data.PassengerTempSetting = v);
            changed |= AssignDouble(root, "inside_temp", v => data.InsideTemp = v);
            changed |= AssignDouble(root, "outside_temp", v => data.OutsideTemp = v);

            if (root.TryGetProperty("climate_keeper_mode", out var keeper) && keeper.ValueKind == JsonValueKind.String)
            {
                data.ClimateKeeperMode = keeper.GetString();
                changed = true;
            }

            // Max-defrost (set_preconditioning_max) drives `defrost_mode`:
            // 0 = off, 2 = max. When the Fleet payload doesn't include
            // the per-defroster booleans (older firmwares) we derive both
            // sides from defrost_mode so the Home "Dégivrage" pill still
            // reflects truth after the 5s force-refresh.
            var defrostMode = TryGetInt(root, "defrost_mode");
            if (defrostMode.HasValue)
            {
                data.DefrostMode = defrostMode.Value;
                if (data.IsFrontDefrosterOn is null) data.IsFrontDefrosterOn = defrostMode.Value != 0;
                if (data.IsRearDefrosterOn is null) data.IsRearDefrosterOn = defrostMode.Value != 0;
                changed = true;
            }
            return changed;
        }
        catch (JsonException)
        {
            return false;
        }
    }

    private static bool ApplyChargeState(MqttLiveData data, string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object) return false;

            var changed = false;
            changed |= AssignBool(root, "charge_port_door_open", v => data.ChargePortDoorOpen = v);

            // PluggedIn is derived: Fleet API doesn't expose a single boolean,
            // but charging_state ∈ {Charging, Stopped, Complete, NoPower, Starting}
            // implies plugged in; "Disconnected" implies unplugged.
            if (root.TryGetProperty("charging_state", out var cs) && cs.ValueKind == JsonValueKind.String)
            {
                var state = cs.GetString();
                data.ChargingState = state;
                data.PluggedIn = !string.Equals(state, "Disconnected", StringComparison.OrdinalIgnoreCase);
                changed = true;
            }

            changed |= AssignInt(root, "battery_level", v => data.BatteryLevel = v);
            changed |= AssignInt(root, "usable_battery_level", v => data.UsableBatteryLevel = v);
            changed |= AssignInt(root, "charger_voltage", v => data.ChargerVoltage = v);
            changed |= AssignInt(root, "charge_limit_soc", v => data.ChargeLimitSoc = v);
            changed |= AssignDouble(root, "charger_power", v => data.ChargerPower = v);
            changed |= AssignDouble(root, "charger_actual_current", v => data.ChargerActualCurrent = v);
            changed |= AssignDouble(root, "charge_energy_added", v => data.ChargeEnergyAdded = v);
            changed |= AssignDouble(root, "time_to_full_charge", v => data.TimeToFullCharge = v);

            // Fleet API reports range in miles → cache stores km.
            var rated = TryGetDouble(root, "battery_range");
            if (rated.HasValue) { data.RatedBatteryRangeKm = rated.Value * 1.609344; changed = true; }
            var ideal = TryGetDouble(root, "ideal_battery_range");
            if (ideal.HasValue) { data.IdealBatteryRangeKm = ideal.Value * 1.609344; changed = true; }
            var est = TryGetDouble(root, "est_battery_range");
            if (est.HasValue) { data.EstBatteryRangeKm = est.Value * 1.609344; changed = true; }

            return changed;
        }
        catch (JsonException)
        {
            return false;
        }
    }

    private static bool AssignBool(JsonElement root, string prop, Action<bool?> set)
    {
        if (!root.TryGetProperty(prop, out var el)) return false;
        switch (el.ValueKind)
        {
            case JsonValueKind.True: set(true); return true;
            case JsonValueKind.False: set(false); return true;
            default: return false;
        }
    }

    private static bool AssignInt(JsonElement root, string prop, Action<int?> set)
    {
        var v = TryGetInt(root, prop);
        if (!v.HasValue) return false;
        set(v.Value);
        return true;
    }

    private static bool AssignDouble(JsonElement root, string prop, Action<double?> set)
    {
        var v = TryGetDouble(root, prop);
        if (!v.HasValue) return false;
        set(v.Value);
        return true;
    }

    private static int? TryGetInt(JsonElement element, string property)
    {
        if (!element.TryGetProperty(property, out var prop)) return null;
        return prop.ValueKind switch
        {
            JsonValueKind.Number => prop.TryGetInt32(out var i) ? i : null,
            JsonValueKind.String when int.TryParse(prop.GetString(), System.Globalization.CultureInfo.InvariantCulture, out var i) => i,
            _ => null,
        };
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
                    try
                    {
                        await _client.DisconnectAsync();
                    }
                    catch (Exception disconnectEx)
                    {
                        _logger.LogDebug(disconnectEx, "MQTT clean disconnect failed during reconnect cycle");
                    }
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

        if (string.IsNullOrEmpty(value)) return;

        var data = _liveData.GetOrAdd(carId, _ => new MqttLiveData());
        ApplyValue(data, key, value);
        data.LastUpdated = DateTime.UtcNow;
        OnLiveDataChanged?.Invoke(carId, data);
    }

    private static void ApplyValue(MqttLiveData data, string key, string value)
    {
        var boolVal = value.Equals("true", StringComparison.OrdinalIgnoreCase) ? true
                    : value.Equals("false", StringComparison.OrdinalIgnoreCase) ? false
                    : (bool?)null;

        switch (key)
        {
            case "locked"                    when boolVal.HasValue: data.Locked = boolVal; break;
            case "doors_open"                when boolVal.HasValue: data.DoorsOpen = boolVal; break;
            case "driver_front_door_open"    when boolVal.HasValue: data.DriverFrontDoorOpen = boolVal; break;
            case "driver_rear_door_open"     when boolVal.HasValue: data.DriverRearDoorOpen = boolVal; break;
            case "passenger_front_door_open" when boolVal.HasValue: data.PassengerFrontDoorOpen = boolVal; break;
            case "passenger_rear_door_open"  when boolVal.HasValue: data.PassengerRearDoorOpen = boolVal; break;
            case "trunk_open"                when boolVal.HasValue: data.TrunkOpen = boolVal; break;
            case "frunk_open"                when boolVal.HasValue: data.FrunkOpen = boolVal; break;
            case "windows_open"              when boolVal.HasValue: data.WindowsOpen = boolVal; break;
            case "sentry_mode"               when boolVal.HasValue: data.SentryMode = boolVal; break;
            case "is_user_present"           when boolVal.HasValue: data.IsUserPresent = boolVal; break;
            case "tpms_pressure_fl":    if (double.TryParse(value, System.Globalization.CultureInfo.InvariantCulture, out var tpfl)) data.TpmsPressureFl = tpfl; break;
            case "tpms_pressure_fr":    if (double.TryParse(value, System.Globalization.CultureInfo.InvariantCulture, out var tpfr)) data.TpmsPressureFr = tpfr; break;
            case "tpms_pressure_rl":    if (double.TryParse(value, System.Globalization.CultureInfo.InvariantCulture, out var tprl)) data.TpmsPressureRl = tprl; break;
            case "tpms_pressure_rr":    if (double.TryParse(value, System.Globalization.CultureInfo.InvariantCulture, out var tprr)) data.TpmsPressureRr = tprr; break;
            case "tpms_soft_warning_fl"      when boolVal.HasValue: data.TpmsSoftWarningFl = boolVal; break;
            case "tpms_soft_warning_fr"      when boolVal.HasValue: data.TpmsSoftWarningFr = boolVal; break;
            case "tpms_soft_warning_rl"      when boolVal.HasValue: data.TpmsSoftWarningRl = boolVal; break;
            case "tpms_soft_warning_rr"      when boolVal.HasValue: data.TpmsSoftWarningRr = boolVal; break;
            case "climate_keeper_mode":  data.ClimateKeeperMode = value; break;
            case "is_preconditioning"        when boolVal.HasValue: data.IsPreconditioning = boolVal; break;
            case "is_climate_on"             when boolVal.HasValue: data.IsClimateOn = boolVal; break;
            case "charge_port_door_open"     when boolVal.HasValue: data.ChargePortDoorOpen = boolVal; break;
            case "plugged_in"                when boolVal.HasValue: data.PluggedIn = boolVal; break;
            case "battery_level":       if (int.TryParse(value, out var bl))  data.BatteryLevel = bl; break;
            case "usable_battery_level": if (int.TryParse(value, out var ubl)) data.UsableBatteryLevel = ubl; break;
            case "rated_battery_range_km":  if (double.TryParse(value, System.Globalization.CultureInfo.InvariantCulture, out var rbr)) data.RatedBatteryRangeKm = rbr; break;
            case "ideal_battery_range_km":  if (double.TryParse(value, System.Globalization.CultureInfo.InvariantCulture, out var ibr)) data.IdealBatteryRangeKm = ibr; break;
            case "latitude":            if (double.TryParse(value, System.Globalization.CultureInfo.InvariantCulture, out var lat)) data.Latitude = lat; break;
            case "longitude":           if (double.TryParse(value, System.Globalization.CultureInfo.InvariantCulture, out var lng)) data.Longitude = lng; break;
            case "inside_temp":         if (double.TryParse(value, System.Globalization.CultureInfo.InvariantCulture, out var it)) data.InsideTemp = it; break;
            case "outside_temp":        if (double.TryParse(value, System.Globalization.CultureInfo.InvariantCulture, out var ot)) data.OutsideTemp = ot; break;
            case "odometer":            if (double.TryParse(value, System.Globalization.CultureInfo.InvariantCulture, out var odo)) data.Odometer = odo; break;
            case "speed":               if (int.TryParse(value, out var spd)) data.Speed = spd; break;
            case "power":               if (int.TryParse(value, out var pwr)) data.Power = pwr; break;
            case "driver_temp_setting":    if (double.TryParse(value, System.Globalization.CultureInfo.InvariantCulture, out var dts)) data.DriverTempSetting = dts; break;
            case "passenger_temp_setting": if (double.TryParse(value, System.Globalization.CultureInfo.InvariantCulture, out var pts)) data.PassengerTempSetting = pts; break;
            case "state":               data.State = value; break;
            // Charging live
            case "charging_state":      data.ChargingState = value; break;
            case "charge_energy_added": if (double.TryParse(value, System.Globalization.CultureInfo.InvariantCulture, out var cea)) data.ChargeEnergyAdded = cea; break;
            case "charger_power":       if (double.TryParse(value, System.Globalization.CultureInfo.InvariantCulture, out var cpw)) data.ChargerPower = cpw; break;
            case "charger_voltage":     if (int.TryParse(value, out var cv)) data.ChargerVoltage = cv; break;
            case "charger_actual_current": if (double.TryParse(value, System.Globalization.CultureInfo.InvariantCulture, out var cac)) data.ChargerActualCurrent = cac; break;
            case "charge_limit_soc":    if (int.TryParse(value, out var cls)) data.ChargeLimitSoc = cls; break;
            case "time_to_full_charge": if (double.TryParse(value, System.Globalization.CultureInfo.InvariantCulture, out var ttfc)) data.TimeToFullCharge = ttfc; break;
            case "est_battery_range_km": if (double.TryParse(value, System.Globalization.CultureInfo.InvariantCulture, out var ebr)) data.EstBatteryRangeKm = ebr; break;
            // Driving live
            case "shift_state":         data.ShiftState = value; break;
            case "heading":             if (int.TryParse(value, out var hdg)) data.Heading = hdg; break;
            case "elevation":           if (int.TryParse(value, out var elv)) data.Elevation = elv; break;
            case "geofence":            data.Geofence = value; break;
            case "active_route":        ApplyActiveRoute(data, value); break;
        }
    }

    private static void ApplyActiveRoute(MqttLiveData data, string value)
    {
        try
        {
            using var doc = JsonDocument.Parse(value);
            var root = doc.RootElement;

            if (root.TryGetProperty("error", out var err) && err.ValueKind == JsonValueKind.String)
            {
                data.ActiveRouteError = err.GetString();
                data.ActiveRouteDestination = null;
                data.ActiveRouteEnergyAtArrival = null;
                data.ActiveRouteMilesToArrival = null;
                data.ActiveRouteMinutesToArrival = null;
                data.ActiveRouteTrafficMinutesDelay = null;
                data.ActiveRouteLatitude = null;
                data.ActiveRouteLongitude = null;
                return;
            }

            data.ActiveRouteError = null;
            data.ActiveRouteDestination = root.TryGetProperty("destination", out var dest) && dest.ValueKind == JsonValueKind.String
                ? dest.GetString()
                : null;
            data.ActiveRouteEnergyAtArrival = TryGetDouble(root, "energy_at_arrival");
            data.ActiveRouteMilesToArrival = TryGetDouble(root, "miles_to_arrival");
            data.ActiveRouteMinutesToArrival = TryGetDouble(root, "minutes_to_arrival");
            data.ActiveRouteTrafficMinutesDelay = TryGetDouble(root, "traffic_minutes_delay");
            if (root.TryGetProperty("location", out var loc) && loc.ValueKind == JsonValueKind.Object)
            {
                data.ActiveRouteLatitude = TryGetDouble(loc, "latitude");
                data.ActiveRouteLongitude = TryGetDouble(loc, "longitude");
            }
        }
        catch (JsonException)
        {
            // Malformed payload — ignore silently to avoid log spam.
        }
    }

    private static double? TryGetDouble(JsonElement element, string property)
    {
        if (!element.TryGetProperty(property, out var prop)) return null;
        return prop.ValueKind switch
        {
            JsonValueKind.Number => prop.TryGetDouble(out var d) ? d : null,
            JsonValueKind.String when double.TryParse(prop.GetString(), System.Globalization.CultureInfo.InvariantCulture, out var d) => d,
            _ => null,
        };
    }

    public override async Task StopAsync(CancellationToken cancellationToken)
    {
        if (_client?.IsConnected == true)
        {
            try
            {
                await _client.DisconnectAsync();
            }
            catch (Exception disconnectEx)
            {
                _logger.LogDebug(disconnectEx, "MQTT clean disconnect failed during shutdown");
            }
        }
        await base.StopAsync(cancellationToken);
    }
}
