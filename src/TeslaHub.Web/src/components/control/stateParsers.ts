import type { VehicleStateSnapshot } from '../../hooks/useVehicleControl';

/**
 * Tiny defensive parsers for the raw Fleet API JSON sub-trees we pass
 * through from the backend. We keep the SPA decoupled from a tightly-
 * typed C# DTO so Tesla can add fields without us shipping a release.
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

export function readClimate(snapshot: VehicleStateSnapshot | undefined): ClimateState {
  return parse<ClimateState>(snapshot?.climateStateJson ?? null);
}

export function readCharge(snapshot: VehicleStateSnapshot | undefined): ChargeState {
  return parse<ChargeState>(snapshot?.chargeStateJson ?? null);
}

export function readVehicle(snapshot: VehicleStateSnapshot | undefined): VehicleState {
  return parse<VehicleState>(snapshot?.vehicleStateJson ?? null);
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
