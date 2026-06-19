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
  CommunityM3Config,
  VEHICLE_MODELS,
  type VehicleModelKey,
} from './vehicleModelConfig';
import {
  modelSlot,
  buildSavedBlob,
  normalizeBlob,
  resolveActiveModelKey,
  vinModelKey,
} from './showroomOverrides';
import {
  type ShowroomVisualState,
  DEFAULT_VISUAL_STATE,
  buildShowroomStubVehicle,
} from './showroomVisualState';
import { ShowroomVisualSection } from './ShowroomVisualSection';
import { ShowroomGeometrySection } from './ShowroomGeometrySection';
import { ShowroomAestheticsSection } from './ShowroomAestheticsSection';
import { ShowroomLightsSection } from './ShowroomLightsSection';
import { ShowroomGlassSection } from './ShowroomGlassSection';

// Lazy-load the viewer — same trick VehicleTopView.tsx uses to keep
// the GLB/three.js bundle off the initial Settings page load.
const VehicleTopView3D = lazy(() => import('./VehicleTopView3D'));

interface Props {
  carId: number | undefined;
}

/** Deterministic JSON stringify — sorts object keys recursively so
 *  two structurally-equivalent objects always serialise to the SAME
 *  string regardless of insertion order. Critical for the dirty
 *  check: the React-state copy keeps insertion order, but Postgres
 *  `jsonb` (the backend storage) re-orders keys alphabetically on
 *  the round-trip. A naive `JSON.stringify` then reports the just-
 *  saved blob as still dirty and the yellow "Modifications non
 *  sauvegardées" badge would never disappear. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map((v) => stableStringify(v)).join(',') + ']';
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return (
    '{' +
    keys
      .map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k]))
      .join(',') +
    '}'
  );
}

/** Structural equality on the override blob — order-insensitive,
 *  good enough for the small JSON we manipulate (no functions, no
 *  Map/Set, no Date). Used to enable/disable Save and to clear the
 *  unsaved-changes warning. */
function isOverrideEqual(
  a: ShowroomOverrides | null | undefined,
  b: ShowroomOverrides | null | undefined,
): boolean {
  return stableStringify(a ?? {}) === stableStringify(b ?? {});
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
  const vin = vehicle?.vin ?? null;

  // `savedOverrides` is the RAW per-car blob from the backend (v2
  // namespaced-by-model, or a legacy flat blob that normalizeBlob
  // migrates on the fly). We never feed it straight to the editor —
  // we slice out the SELECTED model's slot below.
  const {
    savedOverrides: savedBlob,
    wraps,
    isLoading: cfgLoading,
  } = useResolvedModelConfig(carId, vin);

  // Which model the editor is currently tuning. Defaults to the car's
  // displayed model; the picker can switch it to test another model
  // WITHOUT touching the displayed one.
  const [selectedKey, setSelectedKey] = useState<VehicleModelKey>('poppyseed');

  // The model the car DISPLAYS everywhere (Home, cards). Edited via the
  // "Afficher sur cette voiture" toggle; `undefined` = VIN auto-detect.
  const [activeKeyEdit, setActiveKeyEdit] = useState<VehicleModelKey | undefined>(
    undefined,
  );

  // In-flight edits for the SELECTED model's slot. Reset to the saved
  // slot on Discard / model switch / car switch.
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

  // Ephemeral debug visualisation toggles (Showroom-only). Currently
  // just glass coloration; will host paint-region / interior debug
  // toggles in later phases. Always starts off — the colour-coded
  // viewer is jarring as a default.
  const [debugGlass, setDebugGlass] = useState(false);
  const [debugAnchors, setDebugAnchors] = useState(false);
  useEffect(() => {
    setDebugGlass(false);
    setDebugAnchors(false);
  }, [carId]);
  // Stable reference — an inline `{ glass: debugGlass }` on every
  // Showroom re-render (e.g. door open/close buttons) was changing
  // `debug` in PoppyseedModel's cleanedScene deps, re-running the
  // whole material traverse and resetting projection nodes to
  // visible=false WITHOUT useGroundProjections re-firing → lights gone.
  const debugMode = useMemo(
    () => ({ glass: debugGlass, anchors: debugAnchors }),
    [debugGlass, debugAnchors],
  );

  // Hydrate the editor from the saved blob on first load and whenever
  // the user switches cars. We intentionally don't depend on the blob
  // content alone — that would clobber in-flight edits whenever React
  // Query refetches. Re-hydration ONLY on carId change or when the
  // saved blob first arrives.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(false);
  }, [carId]);
  useEffect(() => {
    if (hydrated) return;
    if (cfgLoading) return;
    const active = resolveActiveModelKey(vin, savedBlob);
    setSelectedKey(active);
    setActiveKeyEdit(normalizeBlob(savedBlob, vin).activeModelKey);
    setEditedOverrides(modelSlot(savedBlob, vin, active));
    setHydrated(true);
  }, [hydrated, cfgLoading, savedBlob, vin]);

  // The saved slot for the model currently being edited — the baseline
  // for the dirty check and Discard.
  const savedSlot = useMemo(
    () => modelSlot(savedBlob, vin, selectedKey),
    [savedBlob, vin, selectedKey],
  );
  const savedActiveKey = useMemo(
    () => normalizeBlob(savedBlob, vin).activeModelKey,
    [savedBlob, vin],
  );

  const dirty = useMemo(
    () =>
      !isOverrideEqual(editedOverrides, savedSlot) ||
      activeKeyEdit !== savedActiveKey,
    [editedOverrides, savedSlot, activeKeyEdit, savedActiveKey],
  );

  // What the live preview renders: the edited slot tagged with the
  // selected model key (so the viewer picks the right model + GLB).
  // Memoised so a new object reference doesn't re-resolve the viewer
  // (and reset projection nodes) on every unrelated re-render.
  const viewerOverrides = useMemo(
    () => ({ ...editedOverrides, modelKey: selectedKey }),
    [editedOverrides, selectedKey],
  );

  // Switch the model being edited. Re-hydrates the editor from that
  // model's saved slot; warns before discarding unsaved edits.
  const handleSelectModel = (next: VehicleModelKey) => {
    if (next === selectedKey) return;
    if (
      dirty &&
      !window.confirm(
        t(
          'showroom.confirmModelSwitch',
          'Changer de modèle abandonnera les modifications non sauvegardées de ce modèle. Continuer ?',
        ),
      )
    ) {
      return;
    }
    setSelectedKey(next);
    setEditedOverrides(modelSlot(savedBlob, vin, next));
  };

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
    const blob = buildSavedBlob(
      savedBlob,
      vin,
      selectedKey,
      editedOverrides,
      activeKeyEdit,
    );
    saveMutation.mutate(blob);
  };

  const handleDiscard = () => {
    setEditedOverrides(savedSlot);
    setActiveKeyEdit(savedActiveKey);
  };

  // Tiny "copied" badge that flashes for 1.5s after a successful copy.
  // Used by the Copy-JSON button below — gives a visual ack so the user
  // doesn't wonder whether the clipboard actually got written.
  const [copyFlash, setCopyFlash] = useState(false);
  const handleCopyJson = async () => {
    try {
      const text = JSON.stringify(editedOverrides, null, 2);
      await navigator.clipboard.writeText(text);
      setCopyFlash(true);
      window.setTimeout(() => setCopyFlash(false), 1500);
    } catch {
      // Clipboard API can fail on insecure contexts (http on non-
      // localhost). Fall back to a textarea-based copy so the feature
      // still works when the app is served on plain HTTP over the LAN.
      const ta = document.createElement('textarea');
      ta.value = JSON.stringify(editedOverrides, null, 2);
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        setCopyFlash(true);
        window.setTimeout(() => setCopyFlash(false), 1500);
      } finally {
        document.body.removeChild(ta);
      }
    }
  };

  const handleReset = () => {
    if (!carId) return;
    if (
      !window.confirm(
        t(
          'showroom.confirmReset',
          'Réinitialiser les réglages de TOUS les modèles de cette voiture aux valeurs par défaut ? Cette action est irréversible.',
        ),
      )
    ) {
      return;
    }
    resetMutation.mutate(undefined, {
      onSuccess: () => {
        setEditedOverrides({});
        setActiveKeyEdit(undefined);
        setSelectedKey(vinModelKey(vin));
      },
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

  // SHIPPED defaults for the model being edited. Used by every section
  // so the sliders' "↺ reset" buttons know what to revert to.
  const defaults = VEHICLE_MODELS[selectedKey] ?? PoppyseedConfig;

  // The lights section only does anything when the model declares emissive
  // light nodes. Community / third-party models ship none → hide the section
  // instead of showing dead sliders.
  const hasLightNodes =
    defaults.brakeLightNodes.length +
      defaults.reverseLightNodes.length +
      defaults.headlightNodes.length >
    0;

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
            onClick={handleCopyJson}
            title={t(
              'showroom.copyJsonHint',
              "Copie tes réglages au format JSON — utile pour les promouvoir en défauts du modèle",
            )}
            className={
              'h-8 px-3 text-xs rounded-md bg-[#1a1a1a] border border-[#2a2a2a] ' +
              'text-[#9ca3af] hover:text-white hover:bg-[#2a2a2a] ' +
              'transition-colors'
            }
          >
            {copyFlash
              ? t('showroom.copied', '✓ Copié')
              : t('showroom.copyJson', 'Copier JSON')}
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
                localOverrides={viewerOverrides}
                showroomMode
                debugMode={debugMode}
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
            selectedKey={selectedKey}
            onSelectModel={handleSelectModel}
            displayed={activeKeyEdit === selectedKey}
            onToggleDisplay={(display) =>
              setActiveKeyEdit(display ? selectedKey : undefined)
            }
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
            visualState={visualState}
            onVisualChange={setVisualState}
            debugAnchors={debugAnchors}
            onToggleDebugAnchors={setDebugAnchors}
          />

          <div className="h-px bg-[#1a1a1a]" />

          <ShowroomAestheticsSection
            overrides={editedOverrides}
            onChange={setEditedOverrides}
            defaults={defaults}
            carId={carId}
            wraps={wraps}
          />

          {hasLightNodes && (
            <>
              <div className="h-px bg-[#1a1a1a]" />

              <ShowroomLightsSection
                overrides={editedOverrides}
                onChange={setEditedOverrides}
                defaults={defaults}
              />
            </>
          )}

          {defaults.supportsGlassTint !== false && (
            <>
              <div className="h-px bg-[#1a1a1a]" />

              <ShowroomGlassSection
                overrides={editedOverrides}
                onChange={setEditedOverrides}
                defaults={defaults}
                debugGlass={debugGlass}
                onToggleDebugGlass={setDebugGlass}
              />
            </>
          )}

          {/* Restant — Phase 3b.3d : sentry cameras (XYZ × 7).
              + Phase 4 — drag-gizmos sur les callouts/anchors. */}
          <div className="text-[10px] text-[#4b5563] text-center pt-4 border-t border-[#1a1a1a]">
            {t(
              'showroom.moreSoon',
              'À venir : caméras sentinelles, drag-gizmos…',
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
  { key: 'community', label: CommunityM3Config.displayName },
];

interface ModelSectionProps {
  /** Model currently being edited (drives the editor + live preview). */
  selectedKey: VehicleModelKey;
  /** Switch the model being edited (re-hydrates its saved slot). */
  onSelectModel: (next: VehicleModelKey) => void;
  /** Whether the SELECTED model is the one the car displays everywhere. */
  displayed: boolean;
  /** Set/clear the selected model as the car's displayed model. */
  onToggleDisplay: (display: boolean) => void;
  vin: string | null;
}

function ModelSection({
  selectedKey,
  onSelectModel,
  displayed,
  onToggleDisplay,
  vin,
}: ModelSectionProps) {
  const { t } = useTranslation();

  const autoDetected: VehicleModelKey = vin?.toUpperCase().charAt(3) === 'Y'
    ? 'bayberry'
    : 'poppyseed';

  return (
    <section className="space-y-2">
      <header className="flex items-center justify-between">
        <h3 className="text-xs uppercase tracking-wider text-[#9ca3af] font-medium">
          {t('showroom.sections.model', 'Modèle / Trim')}
        </h3>
      </header>

      <select
        value={selectedKey}
        onChange={(e) => onSelectModel(e.target.value as VehicleModelKey)}
        className={
          'w-full bg-[#0a0a0a] border border-[#2a2a2a] rounded-md px-3 py-2 ' +
          'text-sm text-white focus:border-[#e31937] focus:outline-none'
        }
      >
        {TRIM_OPTIONS.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
            {o.key === autoDetected ? ' · (auto)' : ''}
          </option>
        ))}
      </select>

      {/* Display toggle — each model keeps its OWN calibration slot on
          this car, so switching the picker only changes what you EDIT.
          This checkbox controls what the car actually shows everywhere. */}
      <label className="flex items-center gap-2 text-[11px] text-[#d1d5db] cursor-pointer select-none">
        <input
          type="checkbox"
          checked={displayed}
          onChange={(e) => onToggleDisplay(e.target.checked)}
          className="accent-[#e31937]"
        />
        {t(
          'showroom.displayOnCar',
          'Afficher ce modèle sur cette voiture (Accueil, cartes)',
        )}
      </label>

      <p className="text-[10px] text-[#6b7280]">
        {t(
          'showroom.modelPerCarHint',
          "Tester un modèle n'écrase plus les autres : chaque modèle garde ses propres réglages par voiture. Coche la case pour que cette voiture l'affiche partout.",
        )}
      </p>
    </section>
  );
}
