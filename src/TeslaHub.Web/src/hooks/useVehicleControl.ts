import { useQuery, useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../api/client';

// ── Types ────────────────────────────────────────────────────────────────────

export interface VehicleCapabilities {
  carType: string | null;
  trimBadging: string | null;
  rearSeatHeaters: number;
  thirdRowSeats: string | null;
  sunRoofInstalled: number;
  motorizedChargePort: boolean;
  canActuateTrunks: boolean;
  canAcceptNavigationRequests: boolean;
  plg: boolean;
  pws: boolean;
  hasAirSuspension: boolean;
  hasLudicrousMode: boolean;
  rhd: boolean;
  chargePortType: string | null;
  euVehicle: boolean;
  hasRearSeatHeaters: boolean;
  hasThirdRow: boolean;
  hasSunRoof: boolean;
}

export interface ControlVehicle {
  id: number;
  vin: string;
  displayName: string | null;
  model: string | null;
  keyPaired: boolean;
  telemetryConfigured: boolean;
  capabilities: VehicleCapabilities;
}

export interface ControlAvailability {
  configured: boolean;
  connected: boolean;
  vehicles: ControlVehicle[];
}

export interface VehicleStateSnapshot {
  state: string | null;
  displayName: string | null;
  vehicleConfigJson: string | null;
  chargeStateJson: string | null;
  climateStateJson: string | null;
  vehicleStateJson: string | null;
  driveStateJson: string | null;
  fetchedAt: string;
  capabilitiesUpdated: boolean;
}

export interface CommandResponse {
  ok: boolean;
  wokeUp: boolean | null;
  error: string | null;
}

// ── Hooks ────────────────────────────────────────────────────────────────────

/**
 * Fetches Fleet API availability + per-vehicle capabilities. Cached 60s.
 * Used both by the BottomNav (to decide if "Control" is shown) and by
 * the Control page itself.
 */
export function useControlAvailability() {
  return useQuery<ControlAvailability>({
    queryKey: ['controlAvailability'],
    queryFn: () => api<ControlAvailability>('/tesla-control/availability'),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
}

/**
 * Returns the cached vehicle snapshot (climate/charge/vehicle/drive state).
 * Tesla docs explicitly warn against polling vehicle_data — so this hook
 * has refetchInterval:false. The 30s staleTime mirrors the backend cache.
 */
export function useVehicleState(vehicleId: number | undefined) {
  return useQuery<VehicleStateSnapshot>({
    queryKey: ['vehicleControlState', vehicleId],
    queryFn: () => api<VehicleStateSnapshot>(`/tesla-control/${vehicleId}/state`),
    enabled: !!vehicleId,
    refetchInterval: false,
    staleTime: 30_000,
  });
}

/**
 * Force refresh the snapshot, bypassing the 30s cache. Useful when the
 * user clicks the "Refresh" button or right after a command that changes
 * a state Tesla won't push back via telemetry within a few seconds.
 */
export function useRefreshVehicleState() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vehicleId: number) =>
      api<VehicleStateSnapshot>(`/tesla-control/${vehicleId}/state?force=true`),
    onSuccess: (data, vehicleId) => {
      qc.setQueryData(['vehicleControlState', vehicleId], data);
    },
  });
}

/**
 * Generic command mutation factory. Caller passes the path (relative to
 * /tesla-control/{id}) and the body. Handles:
 *   - the standard CommandResponse / RFC7807 problem JSON shapes
 *   - automatic invalidation of the vehicle state cache after success
 *   - the 4-second hint that the car is being woken up (mirrored from
 *     SendToCarPanel for UX consistency).
 *
 * Returns the standard react-query mutation plus a `wakingHint` boolean
 * the caller can read to render a transparent "Waking your Tesla…" state.
 */
export function useControlMutation<TBody = void>(
  vehicleId: number | undefined,
  pathSuffix: string,
  options?: {
    invalidate?: QueryKey[];
    onSettled?: () => void;
  },
) {
  const qc = useQueryClient();
  const mutation = useMutation<CommandResponse, Error, TBody>({
    mutationFn: async (body: TBody) => {
      if (!vehicleId) throw new Error('No vehicle selected');
      const init: RequestInit = { method: 'POST' };
      if (body !== undefined && body !== null) {
        init.body = JSON.stringify(body);
      }
      return api<CommandResponse>(`/tesla-control/${vehicleId}/${pathSuffix}`, init);
    },
    onSuccess: () => {
      if (vehicleId) {
        qc.invalidateQueries({ queryKey: ['vehicleControlState', vehicleId] });
      }
      options?.invalidate?.forEach((qk) => qc.invalidateQueries({ queryKey: qk }));
    },
    onSettled: options?.onSettled,
  });

  const [wakingHint, setWakingHint] = useState(false);
  useEffect(() => {
    if (!mutation.isPending) {
      setWakingHint(false);
      return;
    }
    const handle = setTimeout(() => setWakingHint(true), 4000);
    return () => clearTimeout(handle);
  }, [mutation.isPending]);

  return { ...mutation, wakingHint };
}

/**
 * Convenience helper for the explicit "Wake" button on the header.
 * Backend can take up to 60s; we let react-query manage the spinner.
 */
export function useWakeVehicle(vehicleId: number | undefined) {
  return useControlMutation(vehicleId, 'wake');
}
