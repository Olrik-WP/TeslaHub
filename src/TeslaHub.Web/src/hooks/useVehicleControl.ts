import { useQuery, useMutation, useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query';
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
 * Module-level debounced force refresh. After ANY successful command
 * we ask the backend to re-read vehicle_data with force=true so the
 * 30s server cache is bypassed and the UI sees the fresh state.
 * Debounced per vehicleId so a burst of taps (e.g. seat heater rows,
 * temperature stepper) only triggers a single refresh at the end.
 *
 * 5-second delay because Tesla itself takes ~3-5s to propagate the
 * effect of a command back to its read API; refreshing earlier would
 * still see the old value.
 *
 * No vampire drain risk: we keep let_sleep=true on the read, and the
 * car was just woken anyway to receive the command — Tesla will let
 * it sleep again after ~10-15min of inactivity, exactly as designed.
 */
const refreshTimers = new Map<number, ReturnType<typeof setTimeout>>();
const POST_COMMAND_REFRESH_DELAY_MS = 5_000;

// Tiny pub/sub so components (RefreshIndicator under the Home SVG and
// at the top of Control) can render a "Updating in 4s…" countdown
// while a force-refresh is pending. Keyed by vehicleId.
type RefreshState = { dueAt: number | null; refreshing: boolean };
const refreshState = new Map<number, RefreshState>();
const refreshListeners = new Set<() => void>();

function notifyRefreshListeners() {
  refreshListeners.forEach((fn) => fn());
}

function setRefreshState(vehicleId: number, state: RefreshState) {
  refreshState.set(vehicleId, state);
  notifyRefreshListeners();
}

function clearRefreshState(vehicleId: number) {
  refreshState.delete(vehicleId);
  notifyRefreshListeners();
}

function scheduleForceRefresh(qc: QueryClient, vehicleId: number) {
  const existing = refreshTimers.get(vehicleId);
  if (existing) clearTimeout(existing);
  setRefreshState(vehicleId, {
    dueAt: Date.now() + POST_COMMAND_REFRESH_DELAY_MS,
    refreshing: false,
  });
  const timer = setTimeout(async () => {
    refreshTimers.delete(vehicleId);
    setRefreshState(vehicleId, { dueAt: null, refreshing: true });
    try {
      const data = await api<VehicleStateSnapshot>(
        `/tesla-control/${vehicleId}/state?force=true`,
      );
      qc.setQueryData(['vehicleControlState', vehicleId], data);
      // Also nudge the TeslaMate-fed VehicleStatus query so the SVG
      // and Home chips re-poll TeslaMate's MQTT cache. TeslaMate may
      // not have the fresh value yet (it polls owner-api on its own
      // schedule), but at least we don't keep a stale React cache.
      qc.invalidateQueries({ queryKey: ['vehicle'] });
    } catch {
      // Force-refresh is best-effort; if Tesla is rate-limiting or the
      // car went offline again we just leave the previous snapshot.
    } finally {
      // Keep "refreshing" visible for ~1s so the indicator gives a
      // tiny "done" pulse instead of disappearing instantly.
      setTimeout(() => clearRefreshState(vehicleId), 1_000);
    }
  }, POST_COMMAND_REFRESH_DELAY_MS);
  refreshTimers.set(vehicleId, timer);
}

/**
 * Subscribes to the post-command refresh state for a given vehicle.
 * Returns secondsUntil (countdown in s, null when no refresh pending)
 * and isRefreshing (true while the actual force-fetch is in flight).
 *
 * Powers the small RefreshIndicator banner under the Home SVG and on
 * the Control page so the user knows fresh values are inbound and
 * doesn't think the page is stuck.
 */
export function useRefreshCountdown(vehicleId: number | undefined) {
  const [, force] = useState(0);

  // Subscribe to module-level updates (state map changes).
  useEffect(() => {
    const fn = () => force((n) => n + 1);
    refreshListeners.add(fn);
    return () => { refreshListeners.delete(fn); };
  }, []);

  // Re-render every second while a countdown is active so the
  // "Updating in Xs…" label ticks down smoothly.
  useEffect(() => {
    if (!vehicleId) return;
    const state = refreshState.get(vehicleId);
    if (!state || state.dueAt === null) return;
    const tick = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(tick);
  });

  if (!vehicleId) return { secondsUntil: null, isRefreshing: false };
  const state = refreshState.get(vehicleId);
  if (!state) return { secondsUntil: null, isRefreshing: false };
  if (state.refreshing) return { secondsUntil: null, isRefreshing: true };
  if (state.dueAt === null) return { secondsUntil: null, isRefreshing: false };

  const remaining = Math.max(0, Math.ceil((state.dueAt - Date.now()) / 1000));
  return { secondsUntil: remaining, isRefreshing: false };
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
        // Immediate invalidate keeps react-query happy + lets a fresh
        // mount fetch through, but the backend's 30s cache means it
        // would still return the stale snapshot. The debounced
        // force-refresh below bypasses that cache 5s later, after
        // Tesla has propagated the command's effect.
        qc.invalidateQueries({ queryKey: ['vehicleControlState', vehicleId] });
        scheduleForceRefresh(qc, vehicleId);
      }
      options?.invalidate?.forEach((qk) => qc.invalidateQueries({ queryKey: qk }));
      if (options?.silent) return;
      const txt = options?.successText ?? t('control.feedback.sent');
      feedback.show('success', data.wokeUp ? `${txt} ${t('control.feedback.wokeNote')}` : txt);
    },
    onError: (err) => {
      // Re-check availability whenever any command fails. The most
      // common reason we'd want to is "KeyNotPaired" — the backend
      // self-heals TeslaVehicle.KeyPaired=false on detection, so a
      // refresh of /availability makes Control hide / show the
      // "Pair the key" banner without the user having to reload.
      qc.invalidateQueries({ queryKey: ['controlAvailability'] });
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
