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

/** One uploaded wrap PNG in the car's library (metadata only — the
 *  bytes are fetched on demand from /wraps/{id}). Mirrors C#
 *  `ShowroomWrapDto`. */
export interface ShowroomWrap {
  id: number;
  name: string;
  sizeBytes: number;
  uploadedAt: string;
}

export interface ShowroomConfigResponse {
  carId: number;
  /** Raw override blob from the DB. The server stores arbitrary JSON,
   *  so we treat the response as `unknown` and cast to ShowroomOverrides
   *  at the merge site — the merge itself is defensive against missing
   *  fields. */
  config: Record<string, unknown>;
  /** ISO-8601 timestamp of the last save. Null when no row exists. */
  updatedAt: string | null;
  /** True when at least one wrap is in the library. Kept for older
   *  bundles still in browser cache — new code reads `wraps.length`. */
  wrapExists: boolean;
  /** Library of every wrap PNG uploaded for this car, most-recent
   *  first. Empty array when the car has never had an upload. */
  wraps: ShowroomWrap[];
}

/**
 * Stable URL for a SPECIFIC wrap upload (by its DB id). The Showroom
 * gallery uses this as the value of `wraps.paintTextureUrl` to pin a
 * given library entry as the active wrap. Embeds the upload date as a
 * cache key so reuploads under the same id (shouldn't happen but
 * defends against any future "in-place edit" flow) bust the browser
 * cache without a hard refresh.
 */
export function wrapPngUrlById(
  carId: number,
  wrapId: number,
  cacheKey?: string | number,
): string {
  const bust = cacheKey ? `?v=${encodeURIComponent(cacheKey)}` : '';
  return `/api/vehicle/${carId}/showroom/wraps/${wrapId}${bust}`;
}

/**
 * Legacy URL — points at the single-wrap endpoint that now aliases
 * the most-recent upload. Old code paths still call this; new code
 * should prefer `wrapPngUrlById`.
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
  /** Server-side flag: at least one custom wrap PNG was uploaded
   *  for this car. */
  wrapExists: boolean;
  /** Library of every uploaded wrap PNG (metadata only — the PNG
   *  bytes are fetched on demand from `wrapPngUrlById`). */
  wraps: ShowroomWrap[];
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
    wrapExists: (data?.wraps?.length ?? 0) > 0 || (data?.wrapExists ?? false),
    wraps: data?.wraps ?? [],
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
 * Strip the file extension and any path component from a File.name
 * so we keep just the user-friendly stem for the wrap library label.
 */
function deriveWrapNameFromFile(file: File): string {
  const base = file.name.split(/[\\/]/).pop() ?? file.name;
  const dotIdx = base.lastIndexOf('.');
  const stem = dotIdx > 0 ? base.slice(0, dotIdx) : base;
  return stem.trim() || 'wrap';
}

/**
 * Add a new wrap PNG to the car's library. Accepts a `File` from a
 * `<input type="file">` / drag-and-drop, or `{ file, name }` to pin
 * an explicit name. The backend enforces PNG signature + 1 MB size
 * cap and returns the freshly created row so the caller can switch
 * the active wrap to it.
 */
export function useUploadShowroomWrap(carId: number | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: File | { file: File; name?: string }) => {
      if (!carId) throw new Error('No carId — cannot upload wrap');
      const file = input instanceof File ? input : input.file;
      const name =
        input instanceof File ? deriveWrapNameFromFile(input) : (input.name ?? deriveWrapNameFromFile(input.file));
      const buffer = await file.arrayBuffer();
      const qs = name ? `?name=${encodeURIComponent(name)}` : '';
      return api<ShowroomWrap>(
        `/vehicle/${carId}/showroom/wraps${qs}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'image/png' },
          body: buffer,
        },
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: showroomQueryKey(carId) });
    },
  });
}

/**
 * Delete a single wrap from the library by its DB id. The rest of
 * the showroom config (sliders, palette, etc.) and any OTHER wraps
 * in the library are preserved. Pass no argument to drop the whole
 * library (legacy "reset wraps" behaviour).
 */
export function useDeleteShowroomWrap(carId: number | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (wrapId?: number) => {
      if (!carId) return Promise.reject(new Error('No carId — cannot delete wrap'));
      const url =
        typeof wrapId === 'number'
          ? `/vehicle/${carId}/showroom/wraps/${wrapId}`
          : `/vehicle/${carId}/showroom/wraps`;
      return api<{ success: boolean }>(url, { method: 'DELETE' });
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
