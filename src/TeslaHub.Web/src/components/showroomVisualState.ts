/**
 * Showroom ephemeral visual state.
 *
 * The Showroom is a "clean sandbox": every body/security/charging/
 * driving signal the real car normally emits via MQTT is **wiped to
 * a neutral baseline** when the viewer mounts in Showroom mode. The
 * user then drives the model from the right-hand panel buttons —
 * "Open all doors", "Drive D", "Sentry ON", "Cable plugged", etc.
 *
 * This state is **never persisted** to the backend. It exists only
 * for the duration of the Showroom session so the user can preview
 * how the car will look in any state without depending on what the
 * real car is actually doing. (Saving these flags would also be
 * meaningless — the live MQTT stream would immediately overwrite
 * them on the Home page.)
 *
 * What IS persisted lives in `ShowroomOverrides` (positions, colors,
 * model selection, anchors). Visual state and calibration are two
 * completely orthogonal concerns.
 */
import type { VehicleStatus } from '../api/queries';

/** All "live" signals the 3D viewer reads, exposed for in-Showroom
 *  manipulation. Everything else (carId / vin / battery / climate / …)
 *  flows through unchanged from the real vehicle. */
export interface ShowroomVisualState {
  // Body
  driverFrontDoorOpen: boolean;
  driverRearDoorOpen: boolean;
  passengerFrontDoorOpen: boolean;
  passengerRearDoorOpen: boolean;
  doorsOpen: boolean; // aggregate (rarely useful but keeps the UI honest)
  frunkOpen: boolean;
  trunkOpen: boolean;
  windowsOpen: boolean;

  // Security
  isLocked: boolean;
  sentryMode: boolean;

  // Charging
  chargePortDoorOpen: boolean;
  pluggedIn: boolean;
  /** Tesla normalises to PascalCase. Empty means "Disconnected". */
  chargingState: 'Disconnected' | 'Stopped' | 'Charging' | 'Starting';

  // Driving
  /** P=Park (default), D=Drive (headlights + projections), R=Reverse
   *  (brake lights + reverse light + rear projection), N=Neutral. */
  shiftState: 'P' | 'D' | 'R' | 'N';
}

/** Neutral baseline applied when the Showroom first opens: car is
 *  parked, locked off, sentry off, everything closed, cable un-mounted.
 *  Exactly what you'd see in a dealer showroom. */
export const DEFAULT_VISUAL_STATE: ShowroomVisualState = {
  driverFrontDoorOpen: false,
  driverRearDoorOpen: false,
  passengerFrontDoorOpen: false,
  passengerRearDoorOpen: false,
  doorsOpen: false,
  frunkOpen: false,
  trunkOpen: false,
  windowsOpen: false,
  isLocked: false,
  sentryMode: false,
  chargePortDoorOpen: false,
  pluggedIn: false,
  chargingState: 'Disconnected',
  shiftState: 'P',
};

/** Take a real `VehicleStatus` and return a copy where every field
 *  the 3D viewer animates from is replaced by `visualState`. The
 *  vehicle identity (carId, vin, name, marketingName, model, …) is
 *  preserved so the model resolver still picks the right GLB. */
export function buildShowroomStubVehicle(
  real: VehicleStatus,
  visualState: ShowroomVisualState,
): VehicleStatus {
  return {
    ...real,
    // Body
    driverFrontDoorOpen: visualState.driverFrontDoorOpen,
    driverRearDoorOpen: visualState.driverRearDoorOpen,
    passengerFrontDoorOpen: visualState.passengerFrontDoorOpen,
    passengerRearDoorOpen: visualState.passengerRearDoorOpen,
    doorsOpen: visualState.doorsOpen,
    frunkOpen: visualState.frunkOpen,
    trunkOpen: visualState.trunkOpen,
    windowsOpen: visualState.windowsOpen,
    // Security
    isLocked: visualState.isLocked,
    sentryMode: visualState.sentryMode,
    // Charging
    chargePortDoorOpen: visualState.chargePortDoorOpen,
    pluggedIn: visualState.pluggedIn,
    chargingState: visualState.chargingState === 'Disconnected'
      ? null
      : visualState.chargingState,
    // Driving
    shiftState: visualState.shiftState,
  };
}

// ──────────────────────────────────────────────────────────────────
// High-level intents — convenient mutators that group multiple flags
// for the "Open all", "Close all", etc. buttons. Each takes the
// current state and returns a new state (immutable / React-friendly).
// ──────────────────────────────────────────────────────────────────

export function openAllOpenings(s: ShowroomVisualState): ShowroomVisualState {
  return {
    ...s,
    frunkOpen: true,
    trunkOpen: true,
    driverFrontDoorOpen: true,
    driverRearDoorOpen: true,
    passengerFrontDoorOpen: true,
    passengerRearDoorOpen: true,
    doorsOpen: true,
    windowsOpen: true,
    chargePortDoorOpen: true,
  };
}

export function closeAllOpenings(s: ShowroomVisualState): ShowroomVisualState {
  return {
    ...s,
    frunkOpen: false,
    trunkOpen: false,
    driverFrontDoorOpen: false,
    driverRearDoorOpen: false,
    passengerFrontDoorOpen: false,
    passengerRearDoorOpen: false,
    doorsOpen: false,
    windowsOpen: false,
    chargePortDoorOpen: false,
  };
}

export function openAllDoors(s: ShowroomVisualState): ShowroomVisualState {
  return {
    ...s,
    driverFrontDoorOpen: true,
    driverRearDoorOpen: true,
    passengerFrontDoorOpen: true,
    passengerRearDoorOpen: true,
    doorsOpen: true,
  };
}

export function closeAllDoors(s: ShowroomVisualState): ShowroomVisualState {
  return {
    ...s,
    driverFrontDoorOpen: false,
    driverRearDoorOpen: false,
    passengerFrontDoorOpen: false,
    passengerRearDoorOpen: false,
    doorsOpen: false,
  };
}

/** Helper for the cable mode tri-toggle in the UI. Maps the 3 modes
 *  to the underlying flag pair (`pluggedIn` + `chargingState`) the
 *  viewer's `useVehicleVisualSync` actually consumes. */
export type CableModeKey = 'off' | 'plugged' | 'charging';

export function setCableMode(
  s: ShowroomVisualState,
  mode: CableModeKey,
): ShowroomVisualState {
  switch (mode) {
    case 'off':
      return { ...s, pluggedIn: false, chargingState: 'Disconnected' };
    case 'plugged':
      return { ...s, pluggedIn: true, chargingState: 'Stopped' };
    case 'charging':
      return { ...s, pluggedIn: true, chargingState: 'Charging' };
  }
}

export function getCableMode(s: ShowroomVisualState): CableModeKey {
  if (s.chargingState === 'Charging' || s.chargingState === 'Starting') return 'charging';
  if (s.pluggedIn) return 'plugged';
  return 'off';
}
