/**
 * Showroom — geometry calibration panel.
 *
 * Live-tunable per-car geometry that the user otherwise has to hand-
 * calibrate in code: wheel offsets, charge port pivot + plug socket,
 * cable ground anchor, camera framing. All deltas write into the
 * partial `ShowroomOverrides` blob and the viewer re-renders in
 * realtime via the same `localOverrides` pipeline as the Modèle/Trim
 * section.
 *
 * The defaults are read from the model config that ALREADY had the
 * overrides applied (resolved config), so the slider's "↺ reset"
 * button always knows the shipped baseline to revert to.
 *
 * UX: collapsible sub-sections. Each toggles open with a chevron;
 * starts collapsed except Roues (the most-fiddled-with calibration).
 */
import { useState } from 'react';
import type { ShowroomOverrides, WheelCorner } from './showroomOverrides';
import type { CalloutKeyName, VehicleModelConfig } from './vehicleModelConfig';
import type { ShowroomVisualState } from './showroomVisualState';
import {
  ShowroomSlider,
  ShowroomVec3Slider,
} from './ShowroomSlider';

interface Props {
  /** Current edit blob (the one persisted on save). */
  overrides: ShowroomOverrides;
  /** Setter. */
  onChange: (next: ShowroomOverrides) => void;
  /** Defaults from the active vehicle model — used as fallback values
   *  when an override field is undefined, and as the target of the
   *  "reset to default" buttons. */
  defaults: VehicleModelConfig;
  /** Ephemeral visual state (sentry toggle, doors, charging…) —
   *  only needed by sub-sections that expose a quick toggle to
   *  preview live calibration (e.g. the Sentry cameras section
   *  flashing red orbs while you drag the XYZ sliders). */
  visualState?: ShowroomVisualState;
  /** Setter for the ephemeral visual state. */
  onVisualChange?: (next: ShowroomVisualState) => void;
}

/** Top-level section props — adds debug-toggle wiring on top of the
 *  shared sub-section `Props`. Kept separate so the per-sub-section
 *  Props stays minimal (sub-sections don't need the debug toggle —
 *  it's a single button rendered by the parent header). */
interface SectionProps extends Props {
  /** Ephemeral debug flag: when true the viewer overlays the geometry
   *  anchor helpers (cable ground sphere, charge port fallback, plug
   *  socket cube, per-wheel spheres, body wireframe). Off by default. */
  debugAnchors: boolean;
  /** Toggle the anchors debug flag. */
  onToggleDebugAnchors: (next: boolean) => void;
}

export function ShowroomGeometrySection({
  overrides,
  onChange,
  defaults,
  visualState,
  onVisualChange,
  debugAnchors,
  onToggleDebugAnchors,
}: SectionProps) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs uppercase tracking-wider text-[#9ca3af] font-medium">
          Géométrie
        </h3>
        {/* Debug toggle — pill style identical to the GlassSection
            debug button so the UX is consistent across debug modes. */}
        <button
          type="button"
          onClick={() => onToggleDebugAnchors(!debugAnchors)}
          className={
            'h-7 px-2 text-[10px] uppercase tracking-wider rounded-md font-medium ' +
            'transition-colors border ' +
            (debugAnchors
              ? 'bg-[#e31937] border-[#e31937] text-white'
              : 'bg-[#1a1a1a] border-[#2a2a2a] text-[#9ca3af] hover:text-white')
          }
          title="Affiche en sur-impression les sphères de calibration (ancrages câble, port de charge, roues, bbox carrosserie)"
        >
          {debugAnchors ? '● Ancrages affichés' : 'Afficher les ancrages'}
        </button>
      </div>
      <p className="text-[10px] text-[#6b7280] -mt-2">
        Position des roues, charge port, superchargeur, câble, caméra. Sauvegardé par voiture.
      </p>
      {debugAnchors && (
        <div className="border border-[#1a2a1a] rounded-md bg-[#0a140a] p-2 space-y-0.5">
          <p className="text-[10px] uppercase tracking-wider text-[#a3e635] font-medium">
            Légende ancrages
          </p>
          <p className="text-[10px] text-[#9ca3af]">
            🟢 cableGroundAnchor &nbsp;·&nbsp; 🟠 supercharger (base + port câble) &nbsp;·&nbsp; 🔴
            fallbackWorld (⚠ si trop proche du centre) &nbsp;·&nbsp; 🟦 plug socket live
          </p>
          <p className="text-[10px] text-[#9ca3af]">
            Roues : 🟢 LF · 🔴 RF · 🟡 LR · 🔵 RR &nbsp;·&nbsp; ⬜ wireframe = bbox carrosserie
          </p>
        </div>
      )}

      <WheelsSection overrides={overrides} onChange={onChange} defaults={defaults} />
      <ChargePortSection overrides={overrides} onChange={onChange} defaults={defaults} />
      <SuperchargerSection overrides={overrides} onChange={onChange} defaults={defaults} />
      <CableSection overrides={overrides} onChange={onChange} defaults={defaults} />
      <SentryCamerasSection
        overrides={overrides}
        onChange={onChange}
        defaults={defaults}
        visualState={visualState}
        onVisualChange={onVisualChange}
      />
      <CalloutsSection overrides={overrides} onChange={onChange} defaults={defaults} />
      <CameraSection overrides={overrides} onChange={onChange} defaults={defaults} />
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────
// Sub-section helper — collapsible header with chevron
// ────────────────────────────────────────────────────────────────────

function SubSection({
  title,
  defaultOpen,
  rightSlot,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  rightSlot?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div className="border border-[#1f1f1f] rounded-md overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={
          'w-full flex items-center justify-between gap-2 px-2 py-1.5 ' +
          'bg-[#181818] hover:bg-[#202020] text-left'
        }
      >
        <div className="flex items-center gap-1.5">
          <span
            className="text-[10px] text-[#6b7280] transition-transform inline-block"
            style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}
          >
            ▶
          </span>
          <span className="text-[11px] uppercase tracking-wider text-[#d4d4d4] font-medium">
            {title}
          </span>
        </div>
        {rightSlot}
      </button>
      {open && <div className="p-2 space-y-3">{children}</div>}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// ROUES — per-corner XYZ + wheel GLB swap
// ────────────────────────────────────────────────────────────────────

// Curated list of every wheel GLB we know exists in the asset pipeline.
// The user can also paste a custom URL via the input below. Grouped by
// model family so the dropdown shows the most relevant ones first.
const KNOWN_WHEELS: Array<{ url: string; label: string; group: string }> = [
  // Model 3 Highland
  { url: '/models/wheel_d50_highland.glb', label: 'D50 Highland (18")', group: 'Model 3' },
  { url: '/models/wheel_cypress.glb',      label: 'Cypress (18")',       group: 'Model 3' },
  { url: '/models/wheel_halo.glb',         label: 'Halo (19")',          group: 'Model 3' },
  { url: '/models/wheel_riptide.glb',      label: 'Riptide Performance (20")', group: 'Model 3' },
  { url: '/models/wheel_standard.glb',     label: 'Standard',            group: 'Model 3' },
  // Model Y Juniper
  { url: '/models/wheel_e41.glb',          label: 'E41 Propulsion (19")', group: 'Model Y' },
  { url: '/models/wheel_gemini_dark.glb',  label: 'Gemini Dark (19")',   group: 'Model Y' },
  { url: '/models/wheel_helix2.glb',       label: 'Helix2 (20")',        group: 'Model Y' },
  { url: '/models/wheel_helix2_dark.glb',  label: 'Helix2 Dark (20")',   group: 'Model Y' },
  { url: '/models/wheel_machina2.glb',     label: 'Machina2 (21")',      group: 'Model Y' },
  { url: '/models/wheel_arachnid_21.glb',  label: 'Arachnid (21")',      group: 'Model Y' },
];

function WheelsSection({ overrides, onChange, defaults }: Props) {
  // Models that bake their wheels into the body (community / third-party)
  // have no separate wheel GLB and no per-corner anchors → the wheel swap +
  // XYZ offsets are meaningless and just force pointless scene rebuilds. Hide
  // the whole section for them.
  const hasSeparateWheels =
    defaults.wheelAnchorNames.length > 0 ||
    defaults.wheelFallbackPositions.length > 0;
  const corners: WheelCorner[] = ['LF', 'RF', 'LR', 'RR'];
  const positions = overrides.wheelFallbackPositions ?? {};

  const setCornerField = (
    corner: WheelCorner,
    field: 'x' | 'y' | 'z' | 'rotY',
    value: number,
  ) => {
    const next = {
      ...positions,
      [corner]: { ...(positions[corner] ?? {}), [field]: value },
    };
    onChange({ ...overrides, wheelFallbackPositions: next });
  };

  const resetCorner = (corner: WheelCorner) => {
    const next = { ...positions };
    delete next[corner];
    onChange({
      ...overrides,
      wheelFallbackPositions: Object.keys(next).length > 0 ? next : undefined,
    });
  };

  const setWheelUrl = (url: string | undefined) => {
    onChange({ ...overrides, wheelUrl: url || undefined });
  };

  const currentUrl = overrides.wheelUrl ?? defaults.wheelUrl;

  if (!hasSeparateWheels) return null;

  return (
    <SubSection title="Roues" defaultOpen>
      {/* Wheel GLB picker */}
      <div className="space-y-1.5">
        <p className="text-[10px] uppercase tracking-wider text-[#6b7280]">
          Modèle de jante
        </p>
        <div className="flex gap-1">
          <select
            value={currentUrl}
            onChange={(e) => setWheelUrl(e.target.value)}
            className={
              'flex-1 bg-[#0a0a0a] border border-[#2a2a2a] rounded px-2 py-1 ' +
              'text-[11px] text-white focus:border-[#e31937] focus:outline-none'
            }
          >
            {/* If the current url isn't in the known list (e.g. legacy
                model default), show it as a synthetic first option. */}
            {!KNOWN_WHEELS.some((w) => w.url === currentUrl) && (
              <option value={currentUrl}>{currentUrl} (actuel)</option>
            )}
            {(['Model 3', 'Model Y'] as const).map((g) => (
              <optgroup key={g} label={g}>
                {KNOWN_WHEELS.filter((w) => w.group === g).map((w) => (
                  <option key={w.url} value={w.url}>
                    {w.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {overrides.wheelUrl && (
            <button
              type="button"
              onClick={() => setWheelUrl(undefined)}
              title="Revenir au modèle par défaut"
              className="h-7 px-2 text-[10px] rounded bg-[#1a1a1a] text-[#6b7280] hover:text-white"
            >
              ↺
            </button>
          )}
        </div>
        <p className="text-[10px] text-[#4b5563]">
          Si le GLB n'existe pas dans /models/, la roue restera invisible.
        </p>
      </div>

      {/* Per-corner XYZ. Compact grid: 2x2 of corner cards. */}
      <div className="grid grid-cols-2 gap-2">
        {corners.map((corner) => {
          const def = defaults.wheelFallbackPositions.find((p) => p.id === corner);
          if (!def) return null;
          const ov = positions[corner];
          const current: [number, number, number] = [
            ov?.x ?? def.x,
            ov?.y ?? def.y,
            ov?.z ?? def.z,
          ];
          const currentRotY = ov?.rotY ?? def.rotY ?? 0;
          const cornerOverridden = !!ov;
          return (
            <div
              key={corner}
              className="border border-[#1a1a1a] rounded p-1.5 space-y-1.5"
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono text-[#d4d4d4]">{corner}</span>
                {cornerOverridden && (
                  <button
                    type="button"
                    onClick={() => resetCorner(corner)}
                    title="Réinitialiser ce coin"
                    className="w-4 h-4 flex items-center justify-center text-[9px] rounded text-[#6b7280] hover:text-white hover:bg-[#2a2a2a]"
                  >
                    ↺
                  </button>
                )}
              </div>
              <ShowroomSlider
                label="X"
                value={current[0]}
                onChange={(n) => setCornerField(corner, 'x', n)}
                defaultValue={def.x}
                min={-3}
                max={3}
                step={0.005}
                unit="m"
              />
              <ShowroomSlider
                label="Y"
                value={current[1]}
                onChange={(n) => setCornerField(corner, 'y', n)}
                defaultValue={def.y}
                min={0}
                max={1}
                step={0.005}
                unit="m"
              />
              <ShowroomSlider
                label="Z"
                value={current[2]}
                onChange={(n) => setCornerField(corner, 'z', n)}
                defaultValue={def.z}
                min={-3}
                max={3}
                step={0.005}
                unit="m"
              />
              <ShowroomSlider
                label="Rot"
                value={currentRotY}
                onChange={(n) => setCornerField(corner, 'rotY', n)}
                defaultValue={def.rotY ?? 0}
                min={-180}
                max={180}
                step={1}
                unit="°"
              />
            </div>
          );
        })}
      </div>
    </SubSection>
  );
}

// ────────────────────────────────────────────────────────────────────
// CHARGE PORT — pivot world position + plug socket offset + plug direction
// ────────────────────────────────────────────────────────────────────

function ChargePortSection({ overrides, onChange, defaults }: Props) {
  const cp = overrides.chargePort ?? {};
  const setField = <K extends keyof VehicleModelConfig['chargePort']>(
    key: K,
    value: VehicleModelConfig['chargePort'][K],
  ) => {
    onChange({ ...overrides, chargePort: { ...cp, [key]: value } });
  };

  const fallbackWorld = (cp.fallbackWorld ?? defaults.chargePort.fallbackWorld) as
    [number, number, number];
  const pivotToSocketOffset = (cp.pivotToSocketOffset ?? defaults.chargePort.pivotToSocketOffset) as
    [number, number, number];
  const plugDirection = (cp.plugDirection ?? defaults.chargePort.plugDirection) as
    [number, number, number];

  return (
    <SubSection title="Charge port">
      <ShowroomVec3Slider
        label="Position monde (fallback)"
        value={fallbackWorld}
        onChange={(v) => setField('fallbackWorld', v)}
        defaultValue={defaults.chargePort.fallbackWorld as [number, number, number]}
        min={-4}
        max={4}
        step={0.005}
        unit="m"
      />
      <ShowroomVec3Slider
        label="Pivot → socket offset"
        value={pivotToSocketOffset}
        onChange={(v) => setField('pivotToSocketOffset', v)}
        defaultValue={defaults.chargePort.pivotToSocketOffset as [number, number, number]}
        min={-1.5}
        max={1.5}
        step={0.005}
        unit="m"
      />
      <ShowroomVec3Slider
        label="Direction prise (unit vector)"
        value={plugDirection}
        onChange={(v) => setField('plugDirection', v)}
        defaultValue={defaults.chargePort.plugDirection as [number, number, number]}
        min={-1}
        max={1}
        step={0.01}
      />
      <p className="text-[10px] text-[#6b7280]">
        Direction = vecteur unitaire de l'extérieur vers la prise. (0, 0, 1) =
        latéral gauche. Garder normalisé pour éviter les distorsions de câble.
      </p>
    </SubSection>
  );
}

// ────────────────────────────────────────────────────────────────────
// SUPERCHARGER — post placement + cable port offset
// ────────────────────────────────────────────────────────────────────

function SuperchargerSection({ overrides, onChange, defaults }: Props) {
  const sc = { ...defaults.supercharger, ...overrides.supercharger };
  const isOverridden = !!overrides.supercharger;

  const patch = (patch: Partial<typeof sc>) => {
    onChange({ ...overrides, supercharger: { ...overrides.supercharger, ...patch } });
  };

  const reset = () => {
    const { supercharger: _, ...rest } = overrides;
    void _;
    onChange(rest);
  };

  return (
    <SubSection
      title="Superchargeur"
      rightSlot={
        isOverridden ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              reset();
            }}
            className="text-[10px] text-[#6b7280] hover:text-white"
          >
            ↺ Reset
          </button>
        ) : null
      }
    >
      <ShowroomVec3Slider
        label="Position du poteau (base)"
        value={sc.position}
        onChange={(v) => patch({ position: v })}
        defaultValue={defaults.supercharger.position}
        min={-8}
        max={8}
        step={0.05}
        unit="m"
      />
      <ShowroomSlider
        label="Rotation Y (face à la voiture)"
        value={sc.rotationY}
        onChange={(v) => patch({ rotationY: v })}
        defaultValue={defaults.supercharger.rotationY}
        min={-180}
        max={180}
        step={1}
        unit="°"
      />
      <ShowroomSlider
        label="Échelle (modèle CC tiers)"
        value={sc.scale ?? 1}
        onChange={(v) => patch({ scale: v })}
        defaultValue={defaults.supercharger.scale ?? 1}
        min={0.05}
        max={5}
        step={0.01}
        unit="×"
      />
      <ShowroomVec3Slider
        label="Offset port câble (local → orange)"
        value={sc.cablePortOffset}
        onChange={(v) => patch({ cablePortOffset: v })}
        defaultValue={defaults.supercharger.cablePortOffset}
        min={-2}
        max={2}
        step={0.01}
        unit="m"
      />
      <p className="text-[10px] text-[#6b7280]">
        Affiché en mode « Branché » ou « Recharge ». Le câble va port SC → ancrage sol
        (vert) → port voiture. Calibre avec « Afficher les ancrages ».
      </p>
    </SubSection>
  );
}

// ────────────────────────────────────────────────────────────────────
// CÂBLE — ground anchor (où le câble pose au sol)
// ────────────────────────────────────────────────────────────────────

function CableSection({ overrides, onChange, defaults }: Props) {
  const setAnchor = (v: [number, number, number]) => {
    onChange({ ...overrides, cableGroundAnchor: v });
  };
  const resetAnchor = () => {
    const { cableGroundAnchor: _, ...rest } = overrides;
    void _;
    onChange(rest);
  };
  const current = (overrides.cableGroundAnchor ?? defaults.cableGroundAnchor) as
    [number, number, number];
  const isOverridden = !!overrides.cableGroundAnchor;

  return (
    <SubSection
      title="Câble"
      rightSlot={
        isOverridden ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              resetAnchor();
            }}
            className="text-[10px] text-[#6b7280] hover:text-white"
          >
            ↺ Reset
          </button>
        ) : null
      }
    >
      <ShowroomVec3Slider
        label="Ancrage sol (où le câble pose)"
        value={current}
        onChange={setAnchor}
        defaultValue={defaults.cableGroundAnchor as [number, number, number]}
        min={-6}
        max={6}
        step={0.05}
        unit="m"
      />
      <p className="text-[10px] text-[#6b7280]">
        Point intermédiaire au sol entre le Superchargeur et la voiture. Alignez-le
        sur la sphère orange (port SC) pour un branchement réaliste.
      </p>

      <ShowroomSlider
        label="Longueur câble côté Superchargeur"
        value={overrides.cableSlackPost ?? defaults.cableSlack.post}
        onChange={(v) => onChange({ ...overrides, cableSlackPost: v })}
        defaultValue={defaults.cableSlack.post}
        min={0.2}
        max={2}
        step={0.05}
      />
      <ShowroomSlider
        label="Longueur câble côté voiture"
        value={overrides.cableSlackCar ?? defaults.cableSlack.car}
        onChange={(v) => onChange({ ...overrides, cableSlackCar: v })}
        defaultValue={defaults.cableSlack.car}
        min={0.2}
        max={2}
        step={0.05}
      />
      <p className="text-[10px] text-[#6b7280]">
        1.0 = défaut. &lt;1 = câble tendu/court. &gt;1 = plus de mou.
      </p>
    </SubSection>
  );
}

// ────────────────────────────────────────────────────────────────────
// CAMÉRAS SENTRY — XYZ per camera (7 cameras on M3 Highland / Y Juniper)
//
// Tesla's Sentinel mode lights up small red pulsing markers at the
// approximate world position of each surveillance camera. The defaults
// in `vehicleModelConfig` are eye-calibrated against the real car —
// good but not pixel-perfect, hence the per-camera Showroom override.
//
// Storage: the FULL array is replaced when ANY camera is touched. We
// reconstruct the array by overlaying the override on top of the
// defaults at the same index so a single-camera tweak doesn't blow
// away the other six. When every camera matches its default after a
// reset, the override is dropped entirely to keep the saved blob
// minimal.
// ────────────────────────────────────────────────────────────────────

const SENTRY_CAMERA_LABELS: ReadonlyArray<string> = [
  'Rétroviseur intérieur (haut pare-brise)',
  'Pare-chocs avant centre',
  'Aile avant gauche',
  'Aile avant droite',
  'Pied milieu (B-pillar) gauche',
  'Pied milieu (B-pillar) droit',
  'Hayon (au-dessus plaque)',
];

function SentryCamerasSection({
  overrides,
  onChange,
  defaults,
  visualState,
  onVisualChange,
}: Props) {
  const defaultsCams = defaults.sentryCameraPositions as ReadonlyArray<
    [number, number, number]
  >;
  if (!defaultsCams || defaultsCams.length === 0) return null;

  // Quick toggle for the Sentinelle pulse — usually buried under
  // Visuels, but you can't calibrate camera positions without seeing
  // the red orbs, so we mirror the toggle right next to the sliders.
  const sentryOn = !!visualState?.sentryMode;
  const canToggleSentry = !!visualState && !!onVisualChange;
  const toggleSentry = () => {
    if (!visualState || !onVisualChange) return;
    onVisualChange({ ...visualState, sentryMode: !visualState.sentryMode });
  };

  const overrideCams = overrides.sentryCameraPositions;
  // Reconstruct the active list slot-by-slot — overrideCams may have
  // fewer entries than defaults (e.g. saved blob predates a camera
  // being added to the model config); we fall back to the default at
  // each index that the override doesn't cover.
  const current: Array<[number, number, number]> = defaultsCams.map((d, i) => {
    const ov = overrideCams?.[i];
    return ov ? [ov[0], ov[1], ov[2]] : [d[0], d[1], d[2]];
  });

  const eq = (a: [number, number, number], b: readonly [number, number, number]) =>
    Math.abs(a[0] - b[0]) < 1e-6 &&
    Math.abs(a[1] - b[1]) < 1e-6 &&
    Math.abs(a[2] - b[2]) < 1e-6;

  const commitNext = (next: Array<[number, number, number]>) => {
    const allDefault = next.every((c, i) => eq(c, defaultsCams[i]));
    if (allDefault) {
      const { sentryCameraPositions: _, ...rest } = overrides;
      void _;
      onChange(rest);
    } else {
      onChange({ ...overrides, sentryCameraPositions: next });
    }
  };

  const setCamera = (idx: number, v: [number, number, number]) => {
    const next = current.map((c, i) => (i === idx ? v : c));
    commitNext(next);
  };

  const resetCamera = (idx: number) => {
    const next = current.map((c, i) =>
      i === idx ? ([...defaultsCams[idx]] as [number, number, number]) : c,
    );
    commitNext(next);
  };

  const resetAll = () => {
    const { sentryCameraPositions: _, ...rest } = overrides;
    void _;
    onChange(rest);
  };

  const overridden = !!overrideCams;

  return (
    <SubSection
      title={`Caméras Sentry (${defaultsCams.length})`}
      rightSlot={
        <div className="flex items-center gap-2">
          {canToggleSentry && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                toggleSentry();
              }}
              title={sentryOn ? 'Masquer les points rouges' : 'Afficher les points rouges'}
              className={
                'text-[10px] px-2 py-0.5 rounded border transition-colors ' +
                (sentryOn
                  ? 'border-red-500/60 bg-red-500/15 text-red-300 hover:bg-red-500/25'
                  : 'border-[#2a2a2a] text-[#9ca3af] hover:border-red-500/40 hover:text-red-300')
              }
            >
              {sentryOn ? '● Sentinelle ON' : '○ Sentinelle OFF'}
            </button>
          )}
          {overridden ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                resetAll();
              }}
              className="text-[10px] text-[#6b7280] hover:text-white"
            >
              ↺ Reset
            </button>
          ) : null}
        </div>
      }
    >
      <p className="text-[10px] text-[#6b7280] -mt-1">
        Les points rouges pulsants qui apparaissent quand la Sentinelle
        est activée. Utilise le bouton ci-dessus pour les afficher
        pendant le calage.
      </p>
      {defaultsCams.map((def, idx) => {
        const isOverridden = !eq(current[idx], def);
        return (
          <div
            key={idx}
            className="border border-[#1a1a1a] rounded-md p-2 space-y-1"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] uppercase tracking-wider text-[#9ca3af] font-mono truncate">
                {idx + 1}. {SENTRY_CAMERA_LABELS[idx] ?? `Caméra ${idx + 1}`}
              </p>
              {isOverridden && (
                <button
                  type="button"
                  onClick={() => resetCamera(idx)}
                  title="Réinitialiser cette caméra"
                  className="text-[10px] text-[#6b7280] hover:text-white shrink-0"
                >
                  ↺
                </button>
              )}
            </div>
            <ShowroomVec3Slider
              label=""
              value={current[idx]}
              onChange={(v) => setCamera(idx, v)}
              defaultValue={def as [number, number, number]}
              min={-3}
              max={3}
              step={0.01}
              unit="m"
            />
          </div>
        );
      })}
    </SubSection>
  );
}

// ────────────────────────────────────────────────────────────────────
// CALLOUTS — per-button XYZ nudge on top of the default anchor-above
// position. Lets the user shift the floating Lock / Sentry / Frunk /
// etc. buttons so they sit on the actual door handle, mirror, hood
// line, instead of the auto-lifted default. World axes: +X forward,
// +Y up, +Z right. Defaults to [0,0,0] = unchanged.
// ────────────────────────────────────────────────────────────────────

// Single source of truth lives in `vehicleModelConfig.ts` to keep
// Showroom / VehicleCallouts perfectly in sync. The Showroom only
// needs to expose calibration UI for callouts the viewer actually
// renders, so any new key added there shows up here automatically
// via the type check.
type CalloutKey = CalloutKeyName;

const CALLOUT_DEFS: Array<{ key: CalloutKey; label: string; hint: string; group: 'action' | 'tpms' | 'data' }> = [
  // Action callouts — clickable, trigger Tesla commands.
  { key: 'frunk',       label: 'Frunk',         hint: 'Coffre avant — au-dessus du capot',                  group: 'action' },
  { key: 'trunk',       label: 'Coffre',        hint: 'Coffre arrière — au-dessus du hayon',                group: 'action' },
  { key: 'chargePort',  label: 'Trappe charge', hint: 'Trappe / câble — flanc arrière gauche',              group: 'action' },
  { key: 'window',      label: 'Vitres',        hint: 'Vitres — vitre avant gauche',                        group: 'action' },
  { key: 'lock',        label: 'Verrouillage',  hint: 'Verrouillage — poignée conducteur',                  group: 'action' },
  { key: 'sentry',      label: 'Sentinelle',    hint: 'Sentinelle — caméra de toit ou B-pilier',            group: 'action' },
  { key: 'climate',     label: 'Clim',          hint: 'Climatisation — côté passager',                      group: 'action' },
  { key: 'defrost',     label: 'Dégivrage',     hint: 'Dégivrage — pare-brise (calibrer XYZ)',              group: 'action' },
  { key: 'flash',       label: 'Appels phares', hint: 'Appels phares — au niveau des phares avant',         group: 'action' },
  { key: 'honk',        label: 'Klaxon',        hint: 'Klaxon — capot / calandre',                          group: 'action' },
  // TPMS data callouts — anchored on each wheel wrapper.
  { key: 'tpmsFL',      label: 'TPMS avant G',  hint: 'Pression pneu avant gauche',                         group: 'tpms' },
  { key: 'tpmsFR',      label: 'TPMS avant D',  hint: 'Pression pneu avant droit',                          group: 'tpms' },
  { key: 'tpmsRL',      label: 'TPMS arrière G',hint: 'Pression pneu arrière gauche',                       group: 'tpms' },
  { key: 'tpmsRR',      label: 'TPMS arrière D',hint: 'Pression pneu arrière droit',                        group: 'tpms' },
  // Other data callouts — pure info, no action.
  { key: 'userPresent', label: 'Présence',      hint: 'Conducteur à bord — placer dans l\'habitacle',       group: 'data' },
  { key: 'climateInfo', label: 'Temp. int./ext.',hint: 'Info climat — pare-brise ou toit',                  group: 'data' },
];

function CalloutsSection({ overrides, onChange, defaults }: Props) {
  const offsets = overrides.calloutOffsets ?? {};
  const hidden = overrides.calloutsHidden ?? {};

  const eq = (a: readonly [number, number, number]) =>
    Math.abs(a[0]) < 1e-6 && Math.abs(a[1]) < 1e-6 && Math.abs(a[2]) < 1e-6;

  const setOffset = (key: CalloutKey, v: [number, number, number]) => {
    const next: typeof offsets = { ...offsets, [key]: v };
    // If the new value is back to zero, drop the key entirely so a
    // saved blob stays minimal (no `[0,0,0]` no-op entries).
    if (eq(v)) delete next[key];
    onChange({
      ...overrides,
      calloutOffsets: Object.keys(next).length > 0 ? next : undefined,
    });
  };

  const resetOffset = (key: CalloutKey) => {
    const next = { ...offsets };
    delete next[key];
    onChange({
      ...overrides,
      calloutOffsets: Object.keys(next).length > 0 ? next : undefined,
    });
  };

  // Per-callout visibility — `true` in overrides.calloutsHidden means
  // the callout is HIDDEN on Home / Charging cards. The Showroom still
  // renders it (barré) so the user can drag it / re-enable it.
  const toggleVisible = (key: CalloutKey) => {
    const next = { ...hidden };
    if (next[key]) delete next[key];
    else next[key] = true;
    onChange({
      ...overrides,
      calloutsHidden: Object.keys(next).length > 0 ? next : undefined,
    });
  };

  const resetAll = () => {
    const { calloutOffsets: _o, calloutsHidden: _h, ...rest } = overrides;
    void _o;
    void _h;
    onChange(rest);
  };

  const overridden =
    Object.keys(offsets).length > 0 || Object.keys(hidden).length > 0;
  const defaultOffsets = defaults.calloutOffsets ?? {};

  return (
    <SubSection
      title={`Boutons flottants (${CALLOUT_DEFS.length})`}
      rightSlot={
        overridden ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              resetAll();
            }}
            className="text-[10px] text-[#6b7280] hover:text-white"
          >
            ↺ Reset
          </button>
        ) : null
      }
    >
      <p className="text-[10px] text-[#6b7280] -mt-1">
        Déplace chaque bouton flottant ET son point d'ancrage sur la
        carrosserie. +X = avant · +Y = haut · +Z = droite. La ligne
        relie toujours le bouton à son ancre — bouge les sliders pour
        coller au bon endroit (poignée, capot, vitre…). L'œil
        masque/affiche le bouton sur l'app sans perdre la calibration.
      </p>
      {(['action', 'tpms', 'data'] as const).map((group) => {
        const items = CALLOUT_DEFS.filter((c) => c.group === group);
        if (items.length === 0) return null;
        const groupLabel =
          group === 'action' ? 'Actions' :
          group === 'tpms'   ? 'Pressions pneus' :
          /* data */           'Données';
        return (
          <div key={group} className="space-y-1.5">
            <p className="text-[9px] uppercase tracking-wider text-[#6b7280] pt-1 pl-0.5 font-semibold">
              {groupLabel}
            </p>
            {items.map(({ key, label, hint }) => {
              const value: [number, number, number] = [
                offsets[key]?.[0] ?? defaultOffsets[key]?.[0] ?? 0,
                offsets[key]?.[1] ?? defaultOffsets[key]?.[1] ?? 0,
                offsets[key]?.[2] ?? defaultOffsets[key]?.[2] ?? 0,
              ];
              const isOverridden = !!offsets[key] && !eq(value);
              const isHidden = !!hidden[key];
              return (
                <div
                  key={key}
                  className={
                    'border border-[#1a1a1a] rounded-md p-2 space-y-1 ' +
                    (isHidden ? 'bg-[#0e0e0e] opacity-60' : '')
                  }
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] uppercase tracking-wider text-[#d4d4d4] font-medium truncate">
                        {label}
                        {isHidden && (
                          <span className="ml-1.5 text-[9px] text-[#6b7280] normal-case tracking-normal">
                            (masqué)
                          </span>
                        )}
                      </p>
                      <p className="text-[9px] text-[#6b7280] truncate">{hint}</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {/* Visibility toggle — eye-on / eye-off. */}
                      <button
                        type="button"
                        onClick={() => toggleVisible(key)}
                        title={isHidden ? "Afficher ce bouton sur l'app" : "Masquer ce bouton sur l'app"}
                        className={
                          'w-6 h-6 flex items-center justify-center rounded ' +
                          'border text-[10px] transition-colors ' +
                          (isHidden
                            ? 'border-[#2a2a2a] bg-[#1a1a1a] text-[#6b7280] hover:text-white'
                            : 'border-[#22c55e]/40 bg-[#0a1f0a] text-[#86efac] hover:bg-[#102b10]')
                        }
                      >
                        {isHidden ? <EyeOffGlyph /> : <EyeOnGlyph />}
                      </button>
                      {isOverridden && (
                        <button
                          type="button"
                          onClick={() => resetOffset(key)}
                          title="Réinitialiser la position de ce bouton"
                          className="text-[10px] text-[#6b7280] hover:text-white px-1"
                        >
                          ↺
                        </button>
                      )}
                    </div>
                  </div>
                  <ShowroomVec3Slider
                    label=""
                    value={value}
                    onChange={(v) => setOffset(key, v)}
                    defaultValue={[0, 0, 0]}
                    min={-1.5}
                    max={1.5}
                    step={0.01}
                    unit="m"
                  />
                </div>
              );
            })}
          </div>
        );
      })}
    </SubSection>
  );
}

// Inline eye glyphs for the visibility toggle. Same line weight as the
// other tiny icons in the Showroom panel (kept dependency-free).
function EyeOnGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
function EyeOffGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3l18 18" />
      <path d="M10.6 6.1A10.1 10.1 0 0 1 12 6c6.5 0 10 6 10 6s-1.5 2.5-4 4.4" />
      <path d="M6.6 7.4C3.7 9.4 2 12 2 12s3.5 7 10 7c1.7 0 3.2-.4 4.5-1.1" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </svg>
  );
}

// ────────────────────────────────────────────────────────────────────
// CAMÉRA — position + target + FOV
// ────────────────────────────────────────────────────────────────────

function CameraSection({ overrides, onChange, defaults }: Props) {
  const cp = overrides.cameraPose ?? {};
  const setField = <K extends keyof VehicleModelConfig['cameraPose']>(
    key: K,
    value: VehicleModelConfig['cameraPose'][K],
  ) => {
    onChange({ ...overrides, cameraPose: { ...cp, [key]: value } });
  };
  const resetAll = () => {
    const { cameraPose: _, ...rest } = overrides;
    void _;
    onChange(rest);
  };
  const position = (cp.position ?? defaults.cameraPose.position) as
    [number, number, number];
  const target = (cp.target ?? defaults.cameraPose.target) as
    [number, number, number];
  const fov = cp.fov ?? defaults.cameraPose.fov;
  const overridden = !!overrides.cameraPose && Object.keys(overrides.cameraPose).length > 0;

  // ── Yaw (horizontal rotation) ─────────────────────────────────────
  // Convenience slider that rotates the camera AROUND the car (the
  // OrbitControls target) on the horizontal plane, keeping the same
  // distance and altitude. Updates `cameraPose.position` in cartesian
  // — no extra field added to the config, so the saved override stays
  // a plain XYZ tuple that any downstream consumer already understands.
  //
  // The displayed yaw is computed from the CURRENT (position, target)
  // pair, so reset-to-default works naturally (the default yaw is
  // whatever atan2 gives for the shipped position).
  const dxToCam = position[0] - target[0];
  const dzToCam = position[2] - target[2];
  const horizDist = Math.hypot(dxToCam, dzToCam);
  const radToDeg = 180 / Math.PI;
  const currentYawDeg = Math.atan2(dzToCam, dxToCam) * radToDeg;
  // Default yaw is computed from the SHIPPED position+target, so the
  // ↺ button revert to the shipped framing's yaw — not 0°.
  const defDx = defaults.cameraPose.position[0] - defaults.cameraPose.target[0];
  const defDz = defaults.cameraPose.position[2] - defaults.cameraPose.target[2];
  const defaultYawDeg = Math.atan2(defDz, defDx) * radToDeg;

  const setYawDeg = (newYawDeg: number) => {
    // If the camera is right above the target (no horizontal distance),
    // there's nothing to rotate — bail rather than producing NaN.
    if (horizDist < 1e-4) return;
    const rad = newYawDeg / radToDeg;
    const newX = target[0] + horizDist * Math.cos(rad);
    const newZ = target[2] + horizDist * Math.sin(rad);
    setField('position', [newX, position[1], newZ]);
  };

  return (
    <SubSection
      title="Caméra"
      rightSlot={
        overridden ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              resetAll();
            }}
            className="text-[10px] text-[#6b7280] hover:text-white"
          >
            ↺ Reset
          </button>
        ) : null
      }
    >
      <ShowroomSlider
        label="Yaw"
        value={currentYawDeg}
        onChange={setYawDeg}
        defaultValue={defaultYawDeg}
        min={-180}
        max={180}
        step={1}
        unit="°"
      />
      <p className="text-[10px] text-[#6b7280] -mt-1">
        Rotation horizontale de la caméra autour de la voiture (distance
        et hauteur conservées).
      </p>
      <ShowroomVec3Slider
        label="Position caméra"
        value={position}
        onChange={(v) => setField('position', v)}
        defaultValue={defaults.cameraPose.position as [number, number, number]}
        min={-10}
        max={10}
        step={0.05}
        unit="m"
      />
      <ShowroomVec3Slider
        label="Target (centre de regard)"
        value={target}
        onChange={(v) => setField('target', v)}
        defaultValue={defaults.cameraPose.target as [number, number, number]}
        min={-3}
        max={3}
        step={0.05}
        unit="m"
      />
      <ShowroomSlider
        label="FOV"
        value={fov}
        onChange={(v) => setField('fov', v)}
        defaultValue={defaults.cameraPose.fov}
        min={10}
        max={120}
        step={1}
        unit="°"
      />
      <p className="text-[10px] text-[#6b7280]">
        Astuce : utilise la souris pour orbiter, puis ajuste les sliders
        pour fixer le cadrage par défaut.
      </p>

      <ChargingCameraSubFields
        overrides={overrides}
        onChange={onChange}
        defaults={defaults}
      />
    </SubSection>
  );
}

// ────────────────────────────────────────────────────────────────────
// Caméra en charge — pose secondaire utilisée quand cableMode !== 'off'.
// Optional: si absent, la pose normale est conservée pendant la charge.
// ────────────────────────────────────────────────────────────────────

function ChargingCameraSubFields({ overrides, onChange, defaults }: Props) {
  const fallback = defaults.chargingCameraPose ?? defaults.cameraPose;
  const cp = overrides.chargingCameraPose ?? {};
  const setField = <K extends keyof VehicleModelConfig['cameraPose']>(
    key: K,
    value: VehicleModelConfig['cameraPose'][K],
  ) => {
    onChange({ ...overrides, chargingCameraPose: { ...cp, [key]: value } });
  };
  const resetAll = () => {
    const { chargingCameraPose: _, ...rest } = overrides;
    void _;
    onChange(rest);
  };
  const position = (cp.position ?? fallback.position) as [number, number, number];
  const target = (cp.target ?? fallback.target) as [number, number, number];
  const fov = cp.fov ?? fallback.fov;
  const overridden =
    !!overrides.chargingCameraPose && Object.keys(overrides.chargingCameraPose).length > 0;

  const dispatchPose = (
    pose: { position: [number, number, number]; target: [number, number, number]; fov: number } | null,
  ) => {
    // Always emit fresh array copies so CameraPoseSync's useEffect sees
    // a reference change even when the values are identical to where
    // the camera already sits (typical right after "📸 Capturer").
    const cloned = pose
      ? {
          position: [...pose.position] as [number, number, number],
          target: [...pose.target] as [number, number, number],
          fov: pose.fov,
        }
      : null;
    const canvas = document.querySelector('canvas');
    canvas?.dispatchEvent(
      new CustomEvent('teslahub:set-camera-pose', { detail: { pose: cloned } }),
    );
  };

  // Effective NORMAL pose = shipped defaults + user overrides on cameraPose.
  // Lets the "Vue normale" button glide the camera back even when the
  // cable mode is also "charging" (auto pose === chargingPose → clearing
  // forcedPose would produce zero visible animation).
  const normalCp = overrides.cameraPose ?? {};
  const normalPose = {
    position: (normalCp.position ?? defaults.cameraPose.position) as [number, number, number],
    target: (normalCp.target ?? defaults.cameraPose.target) as [number, number, number],
    fov: normalCp.fov ?? defaults.cameraPose.fov,
  };

  const showCharging = () => dispatchPose({ position, target, fov });
  const showNormal = () => dispatchPose(normalPose);

  const captureCurrent = () => {
    const canvas = document.querySelector('canvas');
    const event = new CustomEvent<{
      onPose: (pose: { position: [number, number, number]; target: [number, number, number]; fov: number }) => void;
    }>('teslahub:capture-camera-pose', {
      detail: {
        onPose: (pose) => {
          onChange({ ...overrides, chargingCameraPose: pose });
        },
      },
    });
    canvas?.dispatchEvent(event);
  };

  return (
    <div className="mt-2 pt-2 border-t border-[#1f1f1f] space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-[10px] uppercase tracking-wider text-[#9ca3af] font-medium">
          Vue « en charge »
        </span>
        <div className="flex items-center gap-1 flex-wrap">
          <button
            type="button"
            onClick={showCharging}
            className="text-[10px] px-2 py-0.5 rounded-md bg-[#1a1a1a] hover:bg-[#202020] border border-[#2a2a2a] text-white"
            title="Bouge la caméra vers la pose de charge actuelle"
          >
            👁 Aller à la vue de charge
          </button>
          <button
            type="button"
            onClick={showNormal}
            className="text-[10px] px-2 py-0.5 rounded-md bg-[#1a1a1a] hover:bg-[#202020] border border-[#2a2a2a] text-white"
            title="Repasse à la caméra normale (pose hors charge)"
          >
            ↩ Vue normale
          </button>
          <button
            type="button"
            onClick={captureCurrent}
            className="text-[10px] px-2 py-0.5 rounded-md bg-[#1a1a1a] hover:bg-[#202020] border border-[#2a2a2a] text-white"
            title="Enregistre la vue actuelle (souris) comme pose de charge"
          >
            📸 Capturer
          </button>
          {overridden && (
            <button
              type="button"
              onClick={resetAll}
              className="text-[10px] text-[#6b7280] hover:text-white"
            >
              ↺ Reset
            </button>
          )}
        </div>
      </div>
      <p className="text-[10px] text-[#6b7280]">
        Cadrage automatique pendant « Branché » / « Recharge ». À tout moment,
        utilise la souris pour orbiter — la caméra te laisse la main jusqu'à ton
        prochain clic sur un de ces boutons.
      </p>
      <ShowroomVec3Slider
        label="Position caméra (charge)"
        value={position}
        onChange={(v) => setField('position', v)}
        defaultValue={fallback.position as [number, number, number]}
        min={-12}
        max={12}
        step={0.05}
        unit="m"
      />
      <ShowroomVec3Slider
        label="Target (charge)"
        value={target}
        onChange={(v) => setField('target', v)}
        defaultValue={fallback.target as [number, number, number]}
        min={-5}
        max={5}
        step={0.05}
        unit="m"
      />
      <ShowroomSlider
        label="FOV (charge)"
        value={fov}
        onChange={(v) => setField('fov', v)}
        defaultValue={fallback.fov}
        min={10}
        max={120}
        step={1}
        unit="°"
      />
    </div>
  );
}
