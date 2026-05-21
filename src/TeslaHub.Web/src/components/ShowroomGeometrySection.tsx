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
import type { VehicleModelConfig } from './vehicleModelConfig';
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
}

export function ShowroomGeometrySection({ overrides, onChange, defaults }: Props) {
  return (
    <section className="space-y-3">
      <h3 className="text-xs uppercase tracking-wider text-[#9ca3af] font-medium">
        Géométrie
      </h3>
      <p className="text-[10px] text-[#6b7280] -mt-2">
        Position des roues, charge port, câble, caméra. Sauvegardé par voiture.
      </p>

      <WheelsSection overrides={overrides} onChange={onChange} defaults={defaults} />
      <ChargePortSection overrides={overrides} onChange={onChange} defaults={defaults} />
      <CableSection overrides={overrides} onChange={onChange} defaults={defaults} />
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
        min={-3}
        max={3}
        step={0.005}
        unit="m"
      />
      <ShowroomVec3Slider
        label="Pivot → socket offset"
        value={pivotToSocketOffset}
        onChange={(v) => setField('pivotToSocketOffset', v)}
        defaultValue={defaults.chargePort.pivotToSocketOffset as [number, number, number]}
        min={-0.3}
        max={0.3}
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
        X négatif = derrière la voiture. Z négatif = à gauche. Y = 0 (sol).
        Typiquement -3 à -4m derrière + 1 à 2m sur le côté.
      </p>
    </SubSection>
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
    </SubSection>
  );
}
