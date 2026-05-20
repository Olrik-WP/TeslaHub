/**
 * READ-ONLY synchronisation between live TeslaMate/MQTT state and the 3D
 * viewer.
 *
 * The 3D viewer reflects vehicle state — it does NOT send commands. All
 * commands stay in HomeQuickActions and the Control page where the
 * existing TeslaMate (`['vehicle', carId]`) + Fleet snapshot
 * (`['vehicleControlState', vehicleId]`) caches are kept consistent
 * through `useControlMutation` optimistic patches.
 *
 * Mapping rules:
 *
 *   VehicleStatus.frunkOpen                  → openings.hood
 *   VehicleStatus.trunkOpen                  → openings.trunk
 *   VehicleStatus.chargePortDoorOpen         → openings.charge_port
 *   VehicleStatus.driverFrontDoorOpen        → openings.door_LF
 *   VehicleStatus.driverRearDoorOpen         → openings.door_LR
 *   VehicleStatus.passengerFrontDoorOpen     → openings.door_RF
 *   VehicleStatus.passengerRearDoorOpen      → openings.door_RR
 *   VehicleStatus.windowsOpen (aggregate)    → openings.window_* (all 4 in
 *                                                vent position)
 *
 * Charging cable derived state:
 *
 *   chargingState ∈ {Charging, Starting}     → cableMode = 'charging'
 *   pluggedIn AND chargingState ≠ Disconnected
 *      AND chargingState ≠ null              → cableMode = 'plugged'
 *   otherwise                                → cableMode = 'off'
 *
 * Tesla normalises chargingState to PascalCase. TeslaMate keeps it as-is.
 * We compare lowercased to avoid coupling to that capitalization.
 *
 * The MQTT cache lags 30–60s but `HomeQuickActions` applies optimistic
 * patches the moment any command is sent — so the 3D viewer reflects the
 * intent of the user immediately (door appears to open as soon as they
 * tap "open trunk"), then settles to truth when MQTT confirms.
 */
import { useEffect } from 'react';
import type { VehicleStatus } from '../api/queries';
import { useOpeningsContext } from './useVehicleOpenings';
import type { CableMode } from './ShowroomControls';

interface UseVehicleVisualSyncOptions {
  vehicle: VehicleStatus | undefined;
  /** Called whenever the derived cable mode changes. */
  onCableModeChange: (mode: CableMode) => void;
}

export function useVehicleVisualSync({ vehicle, onCableModeChange }: UseVehicleVisualSyncOptions) {
  const { set } = useOpeningsContext();

  // --- Openings ------------------------------------------------------------
  // Each useEffect is intentionally narrow on its dependency: it only
  // re-runs when the corresponding MQTT field actually changes, avoiding
  // any wasted setTarget calls (which React batches anyway but the noise
  // matters during debugging the opening animations).
  //
  // We coerce `null` and `undefined` to "closed" by default. This is the
  // safe assumption: a freshly-synced VehicleStatus before the first MQTT
  // overlay has all body signals null, and showing the car all-closed in
  // that case is correct.
  useEffect(() => {
    set('hood', vehicle?.frunkOpen ? 1 : 0);
  }, [vehicle?.frunkOpen, set]);

  useEffect(() => {
    set('trunk', vehicle?.trunkOpen ? 1 : 0);
  }, [vehicle?.trunkOpen, set]);

  useEffect(() => {
    set('charge_port', vehicle?.chargePortDoorOpen ? 1 : 0);
  }, [vehicle?.chargePortDoorOpen, set]);

  useEffect(() => {
    set('door_LF', vehicle?.driverFrontDoorOpen ? 1 : 0);
  }, [vehicle?.driverFrontDoorOpen, set]);

  useEffect(() => {
    set('door_LR', vehicle?.driverRearDoorOpen ? 1 : 0);
  }, [vehicle?.driverRearDoorOpen, set]);

  useEffect(() => {
    set('door_RF', vehicle?.passengerFrontDoorOpen ? 1 : 0);
  }, [vehicle?.passengerFrontDoorOpen, set]);

  useEffect(() => {
    set('door_RR', vehicle?.passengerRearDoorOpen ? 1 : 0);
  }, [vehicle?.passengerRearDoorOpen, set]);

  // Windows: TeslaMate exposes only an aggregate boolean (any window
  // cracked open → true). We reflect that by animating all four at once,
  // which mirrors the "Aérer / Fermer" buttons in HomeQuickActions and
  // OpeningsCard — those send `access/window` with `vent`/`close` and
  // affect all four glass panes simultaneously too. If the user opens a
  // single window manually from inside the car, the aggregate flag will
  // still trip and we'll show all four cracked — visually noisier than
  // reality but truthful with the available signal.
  useEffect(() => {
    const target = vehicle?.windowsOpen ? 1 : 0;
    set('window_LF', target);
    set('window_LR', target);
    set('window_RF', target);
    set('window_RR', target);
  }, [vehicle?.windowsOpen, set]);

  // Mirror auto-fold on lock. Real Teslas fold the side mirrors when
  // the car is parked + locked (provided the "Auto Fold on Park" setting
  // is enabled in the car). Tesla does NOT expose that setting via API,
  // so we assume it's enabled — the default on every modern Model 3/Y.
  // If a user has the auto-fold disabled the 3D will show them folded
  // while in reality they aren't; we consider that acceptable since
  // most owners keep auto-fold on.
  //
  // Edge case: lock state can be null on first MQTT sync. We default
  // to "unfolded" (mirror = 0) when unknown rather than assuming locked,
  // because the most common case is the user actively looking at a
  // parked, unlocked car (i.e. they just got out and are checking the
  // app) — showing folded mirrors there would be wrong.
  useEffect(() => {
    const target = vehicle?.isLocked === true ? 1 : 0;
    set('mirror_LF', target);
    set('mirror_RF', target);
  }, [vehicle?.isLocked, set]);

  // --- Cable mode (derived) ------------------------------------------------
  useEffect(() => {
    const state = (vehicle?.chargingState ?? '').toLowerCase();
    const plugged = vehicle?.pluggedIn ?? false;
    let next: CableMode;
    if (state === 'charging' || state === 'starting') {
      next = 'charging';
    } else if (plugged && state && state !== 'disconnected' && state !== 'unknown') {
      // Stopped / Complete / NoPower with cable physically attached.
      next = 'plugged';
    } else {
      next = 'off';
    }
    onCableModeChange(next);
  }, [vehicle?.chargingState, vehicle?.pluggedIn, onCableModeChange]);
}
