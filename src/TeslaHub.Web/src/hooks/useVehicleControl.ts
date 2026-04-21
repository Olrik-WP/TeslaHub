import { useQuery, useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { useControlFeedback } from '../components/ControlFeedback';

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

/**
 * True once we've successfully fetched vehicle_config at least once
 * (carType is the canonical sentinel — Tesla always returns it). When
 * false, we have NEVER seen the car's options (sleeping car never
 * woken since first sync) and should be permissive about which
 * controls to surface, instead of masking them and confusing the user.
 */
export function capabilitiesLoaded(caps: VehicleCapabilities | undefined): boolean {
  return !!caps?.carType;
}

/**
 * "Show this control unless we're sure the car doesn't have it."
 * Used for features that virtually every modern Tesla has
 * (motorized charge port, actuated trunks, front seat heaters).
 * Strict capability checks belong on rare features (third-row seats).
 */
export function presumeSupported(caps: VehicleCapabilities | undefined, value: boolean): boolean {
  return !capabilitiesLoaded(caps) || value;
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
    /** Optional override for the success toast text. Defaults to a generic "command sent". */
    successText?: string;
    /** Suppress the global toast entirely (used by tight-loop mutations like temp +/-). */
    silent?: boolean;
  },
) {
  const qc = useQueryClient();
  const feedback = useControlFeedback();
  const { t } = useTranslation();

  const mutation = useMutation<CommandResponse, Error, TBody>({
    mutationFn: async (body: TBody) => {
      if (!vehicleId) throw new Error('No vehicle selected');
      const init: RequestInit = { method: 'POST' };
      if (body !== undefined && body !== null) {
        init.body = JSON.stringify(body);
      }
      return api<CommandResponse>(`/tesla-control/${vehicleId}/${pathSuffix}`, init);
    },
    onSuccess: (data) => {
      if (vehicleId) {
        qc.invalidateQueries({ queryKey: ['vehicleControlState', vehicleId] });
      }
      options?.invalidate?.forEach((qk) => qc.invalidateQueries({ queryKey: qk }));
      if (options?.silent) return;
      const txt = options?.successText ?? t('control.feedback.sent');
      feedback.show('success', data.wokeUp ? `${txt} ${t('control.feedback.wokeNote')}` : txt);
    },
    onError: (err) => {
      if (options?.silent) return;
      feedback.show('error', err.message || t('control.feedback.error'));
    },
    onSettled: options?.onSettled,
  });

  const [wakingHint, setWakingHint] = useState(false);
  useEffect(() => {
    if (!mutation.isPending) {
      setWakingHint(false);
      return;
    }
    const handle = setTimeout(() => {
      setWakingHint(true);
      if (!options?.silent) feedback.show('waking', t('control.feedback.waking'));
    }, 4000);
    return () => clearTimeout(handle);
  }, [mutation.isPending]); // eslint-disable-line react-hooks/exhaustive-deps

  return { ...mutation, wakingHint };
}

/**
 * Convenience helper for the explicit "Wake" button on the header.
 * Backend can take up to 60s; we let react-query manage the spinner.
 */
export function useWakeVehicle(vehicleId: number | undefined) {
  return useControlMutation(vehicleId, 'wake');
}
