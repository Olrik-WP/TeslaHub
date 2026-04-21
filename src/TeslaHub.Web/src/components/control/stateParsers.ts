import type { VehicleStateSnapshot } from '../../hooks/useVehicleControl';
import type { VehicleStatus } from '../../api/queries';

/**
 * Tiny defensive parsers for the raw Fleet API JSON sub-trees we pass
 * through from the backend. We keep the SPA decoupled from a tightly-
 * typed C# DTO so Tesla can add fields without us shipping a release.
 *
 * Anti-vampire-drain hydration:
 * Each reader optionally accepts the live TeslaMate VehicleStatus as a
 * fallback. When the Fleet snapshot is empty (sleeping car: we never
 * call vehicle_data on asleep cars) we fall back to the MQTT-pushed
 * values that TeslaMate already broadcasts. Only fields where Fleet
 * has nothing get the MQTT fallback — once the car is online and we
 * have fresh Fleet data, that wins. COP / seat heaters / bioweapon /
 * valet / software_update are NOT in TeslaMate MQTT, so they remain
 * unknown until the user explicitly wakes the car.
 */

function parse<T = Record<string, unknown>>(raw: string | null | undefined): Partial<T> {
  if (!raw) return {} as Partial<T>;
  try {
    return JSON.parse(raw) as Partial<T>;
  } catch {
    return {} as Partial<T>;
  }
}

export interface ClimateState {
  inside_temp?: number;
  outside_temp?: number;
  driver_temp_setting?: number;
  passenger_temp_setting?: number;
  min_avail_temp?: number;
  max_avail_temp?: number;
  is_climate_on?: boolean;
  is_preconditioning?: boolean;
  is_front_defroster_on?: boolean;
  is_rear_defroster_on?: boolean;
  is_auto_conditioning_on?: boolean;
  defrost_mode?: number;
  seat_heater_left?: number;
  seat_heater_right?: number;
  seat_heater_rear_left?: number;
  seat_heater_rear_center?: number;
  seat_heater_rear_right?: number;
  seat_heater_third_row_left?: number;
  seat_heater_third_row_right?: number;
  steering_wheel_heater?: boolean;
  climate_keeper_mode?: string | number;
  bioweapon_mode?: boolean;
  cabin_overheat_protection?: string;
  cabin_overheat_protection_actively_cooling?: boolean;
  cop_activation_temperature?: string;
}

export interface ChargeState {
  battery_level?: number;
  battery_range?: number;
  charge_limit_soc?: number;
  charge_limit_soc_min?: number;
  charge_limit_soc_max?: number;
  charge_amps?: number;
  charge_current_request?: number;
  charge_current_request_max?: number;
  charging_state?: string;
  charge_port_door_open?: boolean;
  charge_port_latch?: string;
  conn_charge_cable?: string;
  charger_actual_current?: number;
  charger_power?: number;
  charger_voltage?: number;
  time_to_full_charge?: number;
  charge_energy_added?: number;
  scheduled_charging_pending?: boolean;
  scheduled_charging_start_time?: number;
}

export interface VehicleState {
  locked?: boolean;
  sentry_mode?: boolean;
  sentry_mode_available?: boolean;
  is_user_present?: boolean;
  odometer?: number;
  car_version?: string;
  df?: number;
  dr?: number;
  pf?: number;
  pr?: number;
  fd_window?: number;
  fp_window?: number;
  rd_window?: number;
  rp_window?: number;
  ft?: number;
  rt?: number;
  valet_mode?: boolean;
  valet_pin_needed?: boolean;
  software_update?: {
    download_perc?: number;
    expected_duration_sec?: number;
    install_perc?: number;
    scheduled_time_ms?: number;
    status?: string;
    version?: string;
  };
  speed_limit_mode?: {
    active?: boolean;
    current_limit_mph?: number;
    max_limit_mph?: number;
    min_limit_mph?: number;
    pin_code_set?: boolean;
  };
}

export interface DriveState {
  speed?: number | null;
  shift_state?: string | null;
  latitude?: number;
  longitude?: number;
  heading?: number;
  gps_as_of?: number;
}

function withFallback<T>(primary: T | undefined, fallback: T | null | undefined): T | undefined {
  return primary !== undefined ? primary : fallback ?? undefined;
}

export function readClimate(
  snapshot: VehicleStateSnapshot | undefined,
  mqtt?: VehicleStatus,
): ClimateState {
  const fleet = parse<ClimateState>(snapshot?.climateStateJson ?? null);
  if (!mqtt) return fleet;
  return {
    ...fleet,
    is_climate_on: withFallback(fleet.is_climate_on, mqtt.isClimateOn),
    is_auto_conditioning_on: withFallback(fleet.is_auto_conditioning_on, mqtt.isClimateOn),
    is_preconditioning: withFallback(fleet.is_preconditioning, mqtt.isPreconditioning),
    is_front_defroster_on: withFallback(fleet.is_front_defroster_on, mqtt.isFrontDefrosterOn),
    is_rear_defroster_on: withFallback(fleet.is_rear_defroster_on, mqtt.isRearDefrosterOn),
    driver_temp_setting: withFallback(fleet.driver_temp_setting, mqtt.driverTempSetting),
    passenger_temp_setting: withFallback(fleet.passenger_temp_setting, mqtt.passengerTempSetting),
    inside_temp: withFallback(fleet.inside_temp, mqtt.insideTemp),
    outside_temp: withFallback(fleet.outside_temp, mqtt.outsideTemp),
    climate_keeper_mode: withFallback(fleet.climate_keeper_mode, mqtt.climateKeeperMode),
  };
}

export function readCharge(
  snapshot: VehicleStateSnapshot | undefined,
  mqtt?: VehicleStatus,
): ChargeState {
  const fleet = parse<ChargeState>(snapshot?.chargeStateJson ?? null);
  if (!mqtt) return fleet;
  return {
    ...fleet,
    battery_level: withFallback(fleet.battery_level, mqtt.batteryLevel),
    charging_state: withFallback(fleet.charging_state, mqtt.chargingState),
    charge_port_door_open: withFallback(fleet.charge_port_door_open, mqtt.chargePortDoorOpen),
    charge_limit_soc: withFallback(fleet.charge_limit_soc, mqtt.chargeLimitSoc),
    charger_actual_current: withFallback(fleet.charger_actual_current, mqtt.chargerActualCurrent),
    charger_voltage: withFallback(fleet.charger_voltage, mqtt.chargerVoltage),
    charger_power: withFallback(fleet.charger_power, mqtt.chargerPower),
    time_to_full_charge: withFallback(fleet.time_to_full_charge, mqtt.timeToFullCharge),
    charge_energy_added: withFallback(fleet.charge_energy_added, mqtt.chargeEnergyAdded),
  };
}

export function readVehicle(
  snapshot: VehicleStateSnapshot | undefined,
  mqtt?: VehicleStatus,
): VehicleState {
  const fleet = parse<VehicleState>(snapshot?.vehicleStateJson ?? null);
  if (!mqtt) return fleet;
  return {
    ...fleet,
    locked: withFallback(fleet.locked, mqtt.isLocked),
    sentry_mode: withFallback(fleet.sentry_mode, mqtt.sentryMode),
    is_user_present: withFallback(fleet.is_user_present, mqtt.isUserPresent),
    odometer: withFallback(fleet.odometer, mqtt.odometer),
    car_version: withFallback(fleet.car_version, mqtt.firmwareVersion),
    // TeslaMate exposes only an aggregate "open" boolean per opening,
    // not the raw CAN value the Fleet API returns. We coerce true→1 so
    // the existing >0 checks in OpeningsCard still work, and leave the
    // detailed door-by-door values undefined when MQTT is the source.
    ft: withFallback(fleet.ft, mqtt.frunkOpen ? 1 : 0),
    rt: withFallback(fleet.rt, mqtt.trunkOpen ? 1 : 0),
    fd_window: withFallback(fleet.fd_window, mqtt.windowsOpen ? 1 : 0),
    fp_window: withFallback(fleet.fp_window, mqtt.windowsOpen ? 1 : 0),
    rd_window: withFallback(fleet.rd_window, mqtt.windowsOpen ? 1 : 0),
    rp_window: withFallback(fleet.rp_window, mqtt.windowsOpen ? 1 : 0),
  };
}

export function readDrive(snapshot: VehicleStateSnapshot | undefined): DriveState {
  return parse<DriveState>(snapshot?.driveStateJson ?? null);
}

/**
 * Tesla returns climate_keeper_mode as either a string ("off"|"keep"|
 * "dog"|"camp") or a number (0|1|2|3). Normalise to the numeric scale
 * the API expects on the way back.
 */
export function keeperModeToInt(mode: string | number | undefined): number {
  if (typeof mode === 'number') return mode;
  switch (mode?.toLowerCase()) {
    case 'on':
    case 'keep':
      return 1;
    case 'dog':
      return 2;
    case 'camp':
      return 3;
    default:
      return 0;
  }
}

/**
 * Tesla COP "current temperature" is one of: "Low"|"Medium"|"High".
 * Map to the integer the set_cop_temp endpoint expects.
 */
export function copTempToInt(level: string | undefined): number {
  switch (level?.toLowerCase()) {
    case 'medium':
      return 1;
    case 'high':
      return 2;
    default:
      return 0;
  }
}
