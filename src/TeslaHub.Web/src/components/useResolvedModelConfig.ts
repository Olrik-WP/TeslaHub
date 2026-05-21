/**
 * Per-car resolved 3D model configuration — fetches the showroom
 * override blob from the backend and merges it on top of the
 * shipped-in-repo defaults.
 *
 * Every page that mounts the 3D viewer (Home, Charging cards, the
 * Showroom page itself…) calls this hook. The query is shared via the
 * React Query cache so we don't refetch per mount. When the user
 * saves a new override in the Showroom, calling `useSaveShowroom` /
 * `useResetShowroom` invalidates this query and every viewer re-renders
 * with the new calibration automatically.
 *
 * The hook accepts an optional `localOverrides` argument that takes
 * precedence over the backend payload. This is what the Showroom page
 * uses to render the user's in-flight edits BEFORE save: every slider
 * tick rebuilds `localOverrides` and the viewer re-renders live. Pass
 * `undefined` from non-Showroom code paths to always render the
 * persisted backend state.
 */
import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import {
  resolveModelConfig,
  resolveModelExtras,
  type ResolvedModelExtras,
  type ShowroomOverrides,
} from './showroomOverrides';
import type { VehicleModelConfig } from './vehicleModelConfig';

// ─── DTOs (mirror C# ShowroomConfigDto) ───────────────────────────────────

export interface ShowroomConfigResponse {
  carId: number;
  /** Raw override blob from the DB. The server stores arbitrary JSON,
   *  so we treat the response as `unknown` and cast to ShowroomOverrides
   *  at the merge site — the merge itself is defensive against missing
   *  fields. */
  config: Record<string, unknown>;
  /** ISO-8601 timestamp of the last save. Null when no row exists. */
  updatedAt: string | null;
}

// ─── Query keys ───────────────────────────────────────────────────────────

export const showroomQueryKey = (carId: number | null | undefined) =>
  ['showroom', carId ?? 'no-car'] as const;

// ─── Read hook ────────────────────────────────────────────────────────────

/**
 * Reads the resolved config for a car. Returns the merged
 * `VehicleModelConfig` plus the raw glass/projection/wraps extras
 * (which haven't been folded into VehicleModelConfig yet — see the
 * Phase 3 refactor).
 *
 * `localOverrides` (optional) layers IN-MEMORY edits on top of the
 * backend payload. Pass `undefined` from production code paths;
 * pass the in-flight state from the Showroom page.
 */
export function useResolvedModelConfig(
  carId: number | null | undefined,
  vin: string | null | undefined,
  localOverrides?: ShowroomOverrides,
): {
  config: VehicleModelConfig;
  extras: ResolvedModelExtras;
  savedOverrides: ShowroomOverrides | undefined;
  isLoading: boolean;
} {
  const { data, isLoading } = useQuery<ShowroomConfigResponse>({
    queryKey: showroomQueryKey(carId),
    queryFn: () => api<ShowroomConfigResponse>(`/vehicle/${carId}/showroom`),
    // Only fetch when we know which car we're talking about. Without
    // a carId the viewer renders the bare defaults (every page that
    // mounts the viewer guarantees a carId, but null defends us
    // against the brief render BEFORE the selectedCar is hydrated).
    enabled: !!carId,
    // The override blob changes rarely (the user saves it manually
    // in Showroom). A long stale time avoids refetching on every
    // viewer mount across pages.
    staleTime: 5 * 60_000,
  });

  // The backend stores `{}` for "no override". We cast through unknown
  // because the API returns it as a generic record — the merge
  // (mergeShowroomConfig) is field-by-field optional-safe.
  const savedOverrides = data?.config as ShowroomOverrides | undefined;

  // Local edits win over the saved blob — the Showroom UI sets this
  // to its in-flight edits so the viewer renders live as the user
  // drags sliders. Non-Showroom code passes undefined and we fall
  // back to the saved blob.
  const effective = localOverrides ?? savedOverrides;

  const extras = useMemo(
    () => resolveModelExtras(vin, effective),
    [vin, effective],
  );

  return {
    config: extras.config,
    extras,
    savedOverrides,
    isLoading,
  };
}

/**
 * Lightweight variant for code paths that only need the merged config
 * (no glass/projection extras yet). Kept separate so the heavier hook
 * isn't dragged into every viewer descendant.
 */
export function useResolvedModelConfigOnly(
  carId: number | null | undefined,
  vin: string | null | undefined,
  localOverrides?: ShowroomOverrides,
): VehicleModelConfig {
  const { data } = useQuery<ShowroomConfigResponse>({
    queryKey: showroomQueryKey(carId),
    queryFn: () => api<ShowroomConfigResponse>(`/vehicle/${carId}/showroom`),
    enabled: !!carId,
    staleTime: 5 * 60_000,
  });

  const saved = data?.config as ShowroomOverrides | undefined;
  const effective = localOverrides ?? saved;
  return useMemo(() => resolveModelConfig(vin, effective), [vin, effective]);
}

// ─── Mutations ────────────────────────────────────────────────────────────

/**
 * Save the full override blob for a car. Optimistic update is NOT
 * applied — we let the server be the source of truth and refetch
 * after success. The override is small (<30 KB typically) so the
 * round-trip is fast enough to skip optimism.
 */
export function useSaveShowroom(carId: number | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (overrides: ShowroomOverrides) => {
      if (!carId) return Promise.reject(new Error('No carId — cannot save Showroom config'));
      return api<{ success: boolean; updatedAt: string }>(
        `/vehicle/${carId}/showroom`,
        {
          method: 'PUT',
          body: JSON.stringify(overrides),
        },
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: showroomQueryKey(carId) });
    },
  });
}

/**
 * Reset to defaults — deletes the override row server-side. After
 * success, every viewer re-renders against the shipped repo defaults.
 */
export function useResetShowroom(carId: number | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => {
      if (!carId) return Promise.reject(new Error('No carId — cannot reset Showroom config'));
      return api<{ success: boolean }>(`/vehicle/${carId}/showroom`, {
        method: 'DELETE',
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: showroomQueryKey(carId) });
    },
  });
}
