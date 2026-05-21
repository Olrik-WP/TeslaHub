/**
 * Showroom — per-car 3D viewer playground / configurator.
 *
 * Mounted from Settings → tab "Showroom" (URL ?tab=showroom). Lets the
 * user dial in every visual parameter of the 3D viewer that is hard
 * to calibrate from code alone (wheel offsets, charge port position,
 * sentry camera placement, glass tints, projection texture URLs…)
 * WITHOUT requiring an API call to the car. Save persists the override
 * blob to the backend (`/api/vehicle/{carId}/showroom`); every page
 * that mounts <VehicleTopView3D> picks it up via the
 * `useResolvedModelConfig` hook so the calibration follows the car
 * everywhere — no double code.
 *
 * Architecture:
 *   - `editedOverrides` (local state) is the in-flight blob.
 *   - The viewer is fed `localOverrides={editedOverrides}` so it
 *     re-renders live as the user moves sliders.
 *   - `savedOverrides` (from backend via React Query) is the last
 *     persisted state; we compare against it to know if the form is
 *     dirty.
 *   - Save mutates the backend and invalidates the query — every
 *     other viewer in the app refetches and re-renders.
 *   - Discard resets `editedOverrides` to `savedOverrides`.
 *   - Reset (server-side DELETE) drops the row entirely → every
 *     viewer falls back to repo defaults.
 *
 * Layout:
 *   - ≥ lg : split horizontal (viewer 65 % left, panel 35 % right).
 *           Standard Blender / Three.js editor pattern.
 *   - < lg : split vertical (viewer 40 vh top sticky, panel
 *           scrollable below). Click-to-edit still works in touch.
 */
import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getVehicleStatus } from '../api/queries';
import {
  useResolvedModelConfig,
  useResetShowroom,
  useSaveShowroom,
} from './useResolvedModelConfig';
import type { ShowroomOverrides } from './showroomOverrides';
import {
  PoppyseedConfig,
  BayberryConfig,
  VEHICLE_MODELS,
  type VehicleModelKey,
} from './vehicleModelConfig';
import { pickResolvedModelKey } from './showroomOverrides';
import {
  type ShowroomVisualState,
  DEFAULT_VISUAL_STATE,
  buildShowroomStubVehicle,
} from './showroomVisualState';
import { ShowroomVisualSection } from './ShowroomVisualSection';
import { ShowroomGeometrySection } from './ShowroomGeometrySection';

// Lazy-load the viewer — same trick VehicleTopView.tsx uses to keep
// the GLB/three.js bundle off the initial Settings page load.
const VehicleTopView3D = lazy(() => import('./VehicleTopView3D'));

interface Props {
  carId: number | undefined;
}

/** Shallow JSON equality — good enough to detect dirty state on the
 *  small override blob (no functions, no Map/Set, no Date). Used to
 *  enable/disable the Save button and trigger the leave-warning. */
function isOverrideEqual(
  a: ShowroomOverrides | null | undefined,
  b: ShowroomOverrides | null | undefined,
): boolean {
  return JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});
}

export default function Showroom({ carId }: Props) {
  const { t } = useTranslation();

  // Live vehicle status — needed for VIN (model resolution) and to
  // feed the viewer's live state (we don't EDIT the car from Showroom,
  // but the viewer reads `vehicle.shiftState`, `isLocked`… to render
  // brake lights, projections, etc.).
  const { data: vehicle, isLoading: vehicleLoading } = useQuery({
    queryKey: ['vehicleStatus', carId],
    queryFn: () => getVehicleStatus(carId!),
    enabled: !!carId,
  });

  // Fetch the persisted override blob. We use the same hook the
  // viewer uses so they share the React Query cache (single network
  // request even though both consume the data).
  const { savedOverrides, isLoading: cfgLoading } = useResolvedModelConfig(
    carId,
    vehicle?.vin ?? null,
  );

  // In-flight edits — starts at the saved blob, updated as the user
  // tweaks sliders. Reset to saved on Discard / when carId changes.
  const [editedOverrides, setEditedOverrides] = useState<ShowroomOverrides>({});

  // EPHEMERAL visual state — drives doors / charging / sentry / shift
  // ONLY for the local Showroom preview. Never persisted. Reset to
  // neutral whenever the user switches cars so the new car starts
  // from a clean baseline.
  const [visualState, setVisualState] = useState<ShowroomVisualState>(
    DEFAULT_VISUAL_STATE,
  );
  useEffect(() => {
    setVisualState(DEFAULT_VISUAL_STATE);
  }, [carId]);

  // Hydrate `editedOverrides` from the saved blob on first load and
  // whenever the user switches cars. We intentionally don't depend on
  // `savedOverrides` content alone — that would clobber in-flight
  // edits whenever React Query refetches. Re-hydration ONLY on carId
  // change or when the saved blob arrives for the FIRST time (i.e.
  // transitions from undefined to something).
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(false);
  }, [carId]);
  useEffect(() => {
    if (hydrated) return;
    if (cfgLoading) return;
    setEditedOverrides(savedOverrides ?? {});
    setHydrated(true);
  }, [hydrated, cfgLoading, savedOverrides]);

  const dirty = useMemo(
    () => !isOverrideEqual(editedOverrides, savedOverrides),
    [editedOverrides, savedOverrides],
  );

  // Mutations
  const saveMutation = useSaveShowroom(carId);
  const resetMutation = useResetShowroom(carId);

  // Warn the user on browser-close / navigation when there are
  // unsaved edits. React Router's blocker would be cleaner but
  // requires v6.4+ data router; beforeunload covers the basic
  // tab-close / refresh case immediately.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Chrome ignores the message but still shows a native prompt.
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  // ─── Handlers ──────────────────────────────────────────────────

  const handleSave = () => {
    if (!carId || !dirty) return;
    saveMutation.mutate(editedOverrides);
  };

  const handleDiscard = () => {
    setEditedOverrides(savedOverrides ?? {});
  };

  const handleReset = () => {
    if (!carId) return;
    if (
      !window.confirm(
        t(
          'showroom.confirmReset',
          'Réinitialiser TOUS les réglages aux valeurs par défaut ? Cette action est irréversible.',
        ),
      )
    ) {
      return;
    }
    resetMutation.mutate(undefined, {
      onSuccess: () => setEditedOverrides({}),
    });
  };

  // ─── Renderers ─────────────────────────────────────────────────

  if (!carId) {
    return (
      <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl p-6 text-center text-[#9ca3af]">
        {t('showroom.noCarSelected', "Sélectionnez une voiture pour ouvrir le Showroom.")}
      </div>
    );
  }

  if (vehicleLoading || cfgLoading) {
    return (
      <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl p-6 text-center text-[#9ca3af]">
        {t('app.loading')}
      </div>
    );
  }

  if (!vehicle) {
    return (
      <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl p-6 text-center text-[#ef4444]">
        {t('showroom.vehicleUnavailable', 'Impossible de charger les données du véhicule.')}
      </div>
    );
  }

  // Build the SANDBOX vehicle for the viewer: identity (carId / vin /
  // marketing name) flows through so the model picker still works,
  // but every live body/security/charging/driving signal is replaced
  // by `visualState`. The viewer's `useVehicleVisualSync` thinks it's
  // reading a real car — it just happens to be a car the user is
  // remote-controlling from the right-hand panel.
  const stubVehicle = buildShowroomStubVehicle(vehicle, visualState);

  // Active model SHIPPED defaults (no overrides applied). Used by the
  // geometry section so the sliders' "↺ reset" buttons know what to
  // revert to. We re-resolve on every render so a model switch made
  // higher in the panel (Modèle/Trim section) is picked up here.
  const activeModelKey = pickResolvedModelKey(vehicle.vin, editedOverrides);
  const defaults = VEHICLE_MODELS[activeModelKey] ?? PoppyseedConfig;

  return (
    <div className="space-y-3">
      {/* Toolbar — sticky on scroll. Title + Save/Discard/Reset. */}
      <div
        className={
          'sticky top-0 z-20 bg-[#0a0a0a]/95 backdrop-blur-md -mx-4 px-4 py-2 ' +
          'border-b border-[#1a1a1a] flex items-center justify-between gap-2'
        }
      >
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-white truncate">
            {t('showroom.title', 'Showroom')} ·{' '}
            <span className="text-[#9ca3af] font-normal">
              {vehicle.name ?? vehicle.marketingName ?? `Car #${carId}`}
            </span>
          </h2>
          {dirty && (
            <p className="text-xs text-amber-400 mt-0.5">
              {t('showroom.unsaved', 'Modifications non sauvegardées')}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={handleDiscard}
            disabled={!dirty || saveMutation.isPending}
            className={
              'h-8 px-3 text-xs rounded-md bg-[#1a1a1a] border border-[#2a2a2a] ' +
              'text-[#9ca3af] hover:text-white hover:bg-[#2a2a2a] ' +
              'disabled:opacity-40 disabled:cursor-not-allowed'
            }
          >
            {t('showroom.discard', 'Annuler')}
          </button>
          <button
            type="button"
            onClick={handleReset}
            disabled={resetMutation.isPending}
            title={t(
              'showroom.resetHint',
              'Supprime tous les réglages — retour aux valeurs par défaut',
            )}
            className={
              'h-8 px-3 text-xs rounded-md bg-[#1a1a1a] border border-[#3a1a1a] ' +
              'text-[#ef4444] hover:bg-[#2a1a1a] disabled:opacity-40 ' +
              'disabled:cursor-not-allowed'
            }
          >
            {t('showroom.reset', 'Réinit.')}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!dirty || saveMutation.isPending}
            className={
              'h-8 px-3 text-xs rounded-md font-medium transition-colors ' +
              (dirty
                ? 'bg-[#e31937] text-white hover:bg-[#c0152f]'
                : 'bg-[#1a1a1a] text-[#6b7280] border border-[#2a2a2a]') +
              ' disabled:opacity-50 disabled:cursor-not-allowed'
            }
          >
            {saveMutation.isPending
              ? t('settings.saving')
              : t('showroom.save', 'Sauvegarder')}
          </button>
        </div>
      </div>

      {/* Body — split horizontal ≥ lg, stacked < lg.
          Viewer keeps its aspect; panel scrolls inside its own column. */}
      <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-3">
        {/* Viewer column */}
        <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl overflow-hidden">
          <div className="aspect-[4/3] lg:aspect-auto lg:h-[calc(100vh-180px)] lg:min-h-[480px]">
            <Suspense
              fallback={
                <div className="h-full flex items-center justify-center text-[#6b7280] text-xs">
                  {t('vehicleView.loading3d', 'Loading 3D model...')}
                </div>
              }
            >
              <VehicleTopView3D
                vehicle={stubVehicle}
                localOverrides={editedOverrides}
                showroomMode
              />
            </Suspense>
          </div>
        </div>

        {/* Tuning panel column */}
        <div
          className={
            'bg-[#141414] border border-[#2a2a2a] rounded-xl p-3 space-y-3 ' +
            'lg:h-[calc(100vh-180px)] lg:overflow-y-auto'
          }
        >
          <ModelSection
            overrides={editedOverrides}
            onChange={setEditedOverrides}
            vin={vehicle.vin}
          />

          <div className="h-px bg-[#1a1a1a]" />

          <ShowroomVisualSection
            state={visualState}
            onChange={setVisualState}
          />

          <div className="h-px bg-[#1a1a1a]" />

          <ShowroomGeometrySection
            overrides={editedOverrides}
            onChange={setEditedOverrides}
            defaults={defaults}
          />

          {/* Sections still pending — esthétique (Phase 3b.3):
              - Paint body (color picker hex Tesla officiel)
              - Intérieur (Decor/cupholder/Wing/Interior2 colors)
              - Jantes (color + roughness + envMapIntensity)
              - Vitres (5 sliders opacity + tint + reflection)
              - Projections (color + opacity + texture URL custom)
              - Sentry cameras (7×XYZ sliders)
              + Phase 4 — drag-gizmos sur les callouts/anchors. */}
          <div className="text-[10px] text-[#4b5563] text-center pt-4 border-t border-[#1a1a1a]">
            {t(
              'showroom.moreSoon',
              'À venir : peinture, intérieur, jantes, vitres, projections, sentinelles…',
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// SECTION — Modèle / Trim
// ────────────────────────────────────────────────────────────────────────────

/** Trim options exposed in the combo. Each entry is a (modelKey,
 *  display label) pair. Y has 3 GLBs (Performance / Propulsion /
 *  Premium) — they're all keyed `bayberry` for now since only one
 *  GLB is wired (bayberry_e41 = Propulsion). Adding Performance and
 *  Premium = switching `bayberry.modelUrl` based on a sub-key,
 *  punted to phase 5. */
const TRIM_OPTIONS: Array<{
  key: VehicleModelKey;
  label: string;
  hint?: string;
}> = [
  { key: 'poppyseed', label: PoppyseedConfig.displayName },
  { key: 'bayberry', label: BayberryConfig.displayName },
];

interface ModelSectionProps {
  overrides: ShowroomOverrides;
  onChange: (next: ShowroomOverrides) => void;
  vin: string | null;
}

function ModelSection({ overrides, onChange, vin }: ModelSectionProps) {
  const { t } = useTranslation();

  // The user's choice (if any) wins; otherwise we show the VIN-based
  // detection so the dropdown reflects what's actually rendering.
  const autoDetected: VehicleModelKey = vin?.toUpperCase().charAt(3) === 'Y'
    ? 'bayberry'
    : 'poppyseed';
  const currentKey = overrides.modelKey ?? autoDetected;
  const isOverridden = !!overrides.modelKey;

  return (
    <section className="space-y-2">
      <header className="flex items-center justify-between">
        <h3 className="text-xs uppercase tracking-wider text-[#9ca3af] font-medium">
          {t('showroom.sections.model', 'Modèle / Trim')}
        </h3>
        {isOverridden && (
          <button
            type="button"
            onClick={() => {
              const { modelKey: _modelKey, ...rest } = overrides;
              void _modelKey;
              onChange(rest);
            }}
            className="text-[10px] text-[#6b7280] hover:text-white"
            title={t('showroom.resetField', 'Revenir à la détection automatique')}
          >
            {t('showroom.auto', 'Auto')}
          </button>
        )}
      </header>

      <select
        value={currentKey}
        onChange={(e) =>
          onChange({ ...overrides, modelKey: e.target.value as VehicleModelKey })
        }
        className={
          'w-full bg-[#0a0a0a] border border-[#2a2a2a] rounded-md px-3 py-2 ' +
          'text-sm text-white focus:border-[#e31937] focus:outline-none'
        }
      >
        {TRIM_OPTIONS.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
            {!isOverridden && o.key === autoDetected ? ' · (auto)' : ''}
          </option>
        ))}
      </select>

      <p className="text-[10px] text-[#6b7280]">
        {isOverridden
          ? t(
              'showroom.modelOverridden',
              'Modèle forcé manuellement. Cliquez "Auto" pour revenir à la détection par VIN.',
            )
          : t(
              'showroom.modelAuto',
              'Détecté à partir du VIN. Cliquez pour forcer un autre modèle.',
            )}
      </p>
    </section>
  );
}
