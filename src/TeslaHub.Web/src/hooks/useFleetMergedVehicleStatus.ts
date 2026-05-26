/**
 * Fuses the Fleet API `vehicle_state` snapshot ON TOP of the TeslaMate
 * MQTT `VehicleStatus` for body-state signals (frunk / trunk / doors /
 * windows / lock / sentry / charge port).
 *
 * Why it exists
 * -------------
 * The Home page (Quick Actions strip, 3D viewer) used to consume
 * `VehicleStatus` directly. That payload is built server-side from
 * TeslaMate's MQTT cache, which polls owner-api on its own schedule
 * (every 30s to 15min depending on the car's state). So when the user
 * closes the frunk physically — or sends a `trunk front` command from
 * Control — the Fleet API has the fresh value within ~5s but the Home
 * 3D viewer keeps showing the frunk open for as long as TeslaMate
 * takes to re-publish (often a minute or more).
 *
 * The Control page already handles this through `readVehicle()` in
 * `control/stateParsers.ts`: it parses `snapshot.vehicleStateJson`
 * (Fleet API, fresh) and falls back to MQTT only for missing fields.
 * `useControlMutation` even auto-fires a Fleet `force=true` refresh 5s
 * after every command — so the Control snapshot is always within
 * seconds of reality.
 *
 * This hook mirrors that strategy for the Home page: it picks the
 * Fleet snapshot when present, and patches the matching boolean
 * fields on the live `VehicleStatus` so EVERY downstream consumer
 * (3D viewer via `useVehicleVisualSync`, Quick Actions buttons,
 * future Home cards) sees the same truth as Control — with the same
 * 5s upper bound on staleness.
 *
 * Coverage
 * --------
 * We override ONLY the fields the Fleet snapshot has a direct value
 * for (raw CAN values in vehicleStateJson). Anything not in the
 * snapshot stays exactly as MQTT served it. The override applies
 * field by field so a missing one (Tesla rarely returns null on
 * actuated openings, but better safe) doesn't wipe out the MQTT
 * value.
 */
import { useMemo } from 'react';
import {
  useControlAvailability,
  useVehicleState,
} from './useVehicleControl';
import { readVehicle } from '../components/control/stateParsers';
import type { VehicleStatus } from '../api/queries';

/**
 * Resolve the Tesla `vehicleId` (Fleet API id) for a TeslaMate car's
 * VIN. Returns the paired account when multiple match (only the paired
 * entry can send signed commands; same logic HomeQuickActions uses).
 */
function useTeslaVehicleId(vin: string | null | undefined): number | undefined {
  const { data: availability } = useControlAvailability();
  return useMemo(() => {
    if (!vin || !availability?.vehicles?.length) return undefined;
    const matches = availability.vehicles.filter((v) => v.vin === vin);
    if (matches.length === 0) return undefined;
    return (matches.find((v) => v.keyPaired) ?? matches[0]).id;
  }, [vin, availability]);
}

/**
 * Returns `vehicle` patched with the freshest Fleet snapshot values
 * for body-state booleans. Pass-through when:
 *   - vehicle is undefined (still loading),
 *   - Fleet API isn't configured / car not in the paired list,
 *   - the snapshot has not yet been fetched once.
 *
 * Cheap (no extra fetch) when the snapshot is already cached — and
 * the snapshot cache is the SAME one Control + `useControlMutation`
 * push fresh values into, so a command sent from anywhere keeps Home
 * in sync within 5s.
 */
export function useFleetMergedVehicleStatus(
  vehicle: VehicleStatus | undefined,
): VehicleStatus | undefined {
  const vehicleId = useTeslaVehicleId(vehicle?.vin ?? null);
  const { data: snapshot } = useVehicleState(vehicleId);

  return useMemo<VehicleStatus | undefined>(() => {
    if (!vehicle) return vehicle;
    if (!snapshot) return vehicle;

    // Reuse the same parser Control uses so the field mapping stays
    // single-sourced. It already coerces "no Fleet snapshot for this
    // field" to `undefined`, letting our `?? vehicle.*` fallback work.
    const v = readVehicle(snapshot, vehicle);

    // Body / openings — every `> 0` becomes true (Fleet returns raw
    // CAN values: 0 = closed, anything else = open). undefined ↦
    // keep MQTT value (vehicle.*).
    // Fleet CAN values: df = driver front door, dr = driver rear,
    // pf = passenger front, pr = passenger rear, ft = front trunk,
    // rt = rear trunk, *_window for each pane.
    const bool = (n: number | undefined): boolean | null | undefined =>
      n === undefined ? undefined : n > 0;
    const fdW = v.fd_window;
    const fpW = v.fp_window;
    const rdW = v.rd_window;
    const rpW = v.rp_window;

    return {
      ...vehicle,
      frunkOpen: bool(v.ft) ?? vehicle.frunkOpen,
      trunkOpen: bool(v.rt) ?? vehicle.trunkOpen,
      driverFrontDoorOpen: bool(v.df) ?? vehicle.driverFrontDoorOpen,
      driverRearDoorOpen: bool(v.dr) ?? vehicle.driverRearDoorOpen,
      passengerFrontDoorOpen: bool(v.pf) ?? vehicle.passengerFrontDoorOpen,
      passengerRearDoorOpen: bool(v.pr) ?? vehicle.passengerRearDoorOpen,
      // Windows: TeslaMate exposes only an aggregate. Fleet gives per-
      // pane values — collapse them to the same aggregate semantics
      // the existing UI expects (any window cracked → true).
      windowsOpen:
        fdW === undefined && fpW === undefined && rdW === undefined && rpW === undefined
          ? vehicle.windowsOpen
          : [fdW, fpW, rdW, rpW].some((w) => (w ?? 0) > 0),
      isLocked: v.locked ?? vehicle.isLocked,
      sentryMode: v.sentry_mode ?? vehicle.sentryMode,
      isUserPresent: v.is_user_present ?? vehicle.isUserPresent,
    };
  }, [vehicle, snapshot]);
}
