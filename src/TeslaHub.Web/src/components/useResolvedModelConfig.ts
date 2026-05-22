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
  /** True when a custom body wrap PNG exists for this car on the
   *  server. The PNG bytes are served on a separate endpoint
   *  (`/vehicle/{carId}/showroom/wrap`) to keep this response small. */
  wrapExists: boolean;
}

/**
 * Stable URL where the per-car user-uploaded wrap PNG lives. Encodes
 * a cache-busting timestamp when the server says the wrap was just
 * updated so the renderer / Showroom thumbnail pick up the new PNG
 * without a hard refresh.
 */
export function wrapPngUrl(carId: number, cacheKey?: string | number): string {
  const bust = cacheKey ? `?v=${encodeURIComponent(cacheKey)}` : '';
  return `/api/vehicle/${carId}/showroom/wrap${bust}`;
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
  /** Server-side flag: a custom wrap PNG was uploaded for this car. */
  wrapExists: boolean;
  /** ISO timestamp of the last save — used to bust the wrap PNG
   *  browser cache after the user uploads a new image. */
  updatedAt: string | null;
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
    wrapExists: data?.wrapExists ?? false,
    updatedAt: data?.updatedAt ?? null,
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
 * Upload (replace) the custom body wrap PNG for a car. Accepts a
 * single PNG `File` from a `<input type="file">` or a drag-and-drop
 * `DataTransfer`. The backend enforces PNG signature + 1 MB size cap.
 * On success we invalidate the showroom query so `wrapExists` flips
 * to true and the renderer re-mounts the texture against the new PNG.
 */
export function useUploadShowroomWrap(carId: number | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      if (!carId) throw new Error('No carId — cannot upload wrap');
      // Hand-roll the request: `api` helper always wraps the body in
      // JSON which would double-encode the PNG bytes. Plain fetch +
      // credentials:'include' carries the auth cookie, same surface
      // as the JSON endpoints.
      const buffer = await file.arrayBuffer();
      const res = await fetch(`/api/vehicle/${carId}/showroom/wrap`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'image/png' },
        body: buffer,
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`Upload wrap failed: ${res.status} ${detail}`);
      }
      return (await res.json()) as {
        success: boolean;
        bytes: number;
        updatedAt: string;
      };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: showroomQueryKey(carId) });
    },
  });
}

/**
 * Remove the custom body wrap PNG for a car. The rest of the
 * showroom config (sliders, palette, etc.) is preserved — only the
 * wrap column is nulled out server-side.
 */
export function useDeleteShowroomWrap(carId: number | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => {
      if (!carId) return Promise.reject(new Error('No carId — cannot delete wrap'));
      return api<{ success: boolean }>(
        `/vehicle/${carId}/showroom/wrap`,
        { method: 'DELETE' },
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
