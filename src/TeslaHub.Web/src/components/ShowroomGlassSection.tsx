/**
 * Showroom — window glass calibration panel.
 *
 * Tesla's exported GLBs layer glass meshes as `Glass` (outer) +
 * `Glass_Interior` (inner) on the windshield + front door windows,
 * while rear door windows on the Y ship as `Glass_Interior` only.
 * Each layer needs different opacity / reflection settings to read
 * as proper automotive glass under the HDR sky.
 *
 * This section exposes the 8 magic numbers that previously lived as
 * hard-coded constants in VehicleTopView3D. The ↑ "Mode debug" toggle
 * colour-codes every glass mesh by its role so the user knows which
 * slider affects which pane:
 *
 *   - **Outer**        → 🔴 red       (windshield, door windows, roof)
 *   - **Inner mixed**  → 🔵 blue      (cabin-side pane behind outer)
 *   - **Inner solo**   → 🟢 green     (Y rear windows, no outer layer)
 *   - **NOMAT glass**  → 🟠 orange    (Bayberry windshield primitive)
 *   - **NOMAT privacy**→ 🟣 violet    (Y rear doors privacy glass)
 *
 * Wiring:
 *   - Numeric sliders write into `overrides.glassFinish` (saved).
 *   - Debug toggle is EPHEMERAL — wired through a parent-owned
 *     `debugFlags` state and passed to `<VehicleTopView3D debugMode>`.
 */
import { useState } from 'react';
import type { ShowroomOverrides } from './showroomOverrides';
import type { VehicleModelConfig } from './vehicleModelConfig';
import { ShowroomSlider } from './ShowroomSlider';

interface Props {
  overrides: ShowroomOverrides;
  onChange: (next: ShowroomOverrides) => void;
  defaults: VehicleModelConfig;
  /** Current ephemeral debug flag (true = colorise glass). */
  debugGlass: boolean;
  /** Toggle the debug flag. */
  onToggleDebugGlass: (next: boolean) => void;
}

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
        className="w-full flex items-center justify-between gap-2 px-2 py-1.5 bg-[#181818] hover:bg-[#202020] text-left"
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
// Debug legend — shown when toggle is active, tells the user what the
// colour codes mean so they don't have to look up the docs.
// ────────────────────────────────────────────────────────────────────

const DEBUG_LEGEND: Array<{ color: string; label: string; hint: string }> = [
  { color: '#ff0000', label: 'Outer', hint: 'Pare-brise, vitres latérales, toit' },
  { color: '#0066ff', label: 'Inner mixed', hint: 'Côté cabine derrière l\'outer (pare-brise inner)' },
  { color: '#00ff66', label: 'Inner solo', hint: 'Vitres arrière Y (pas d\'outer derrière)' },
  { color: '#ff8800', label: 'NOMAT glass', hint: 'Pare-brise Y sans matériau dans le GLB' },
  { color: '#ff00ff', label: 'NOMAT privacy', hint: 'Vitres arrière Y privacy glass' },
];

export function ShowroomGlassSection({
  overrides,
  onChange,
  defaults,
  debugGlass,
  onToggleDebugGlass,
}: Props) {
  const gf = overrides.glassFinish ?? {};
  const setField = <K extends keyof VehicleModelConfig['glassFinish']>(
    key: K,
    value: VehicleModelConfig['glassFinish'][K] | undefined,
  ) => {
    const next = { ...gf };
    if (value === undefined) {
      delete next[key];
    } else {
      next[key] = value;
    }
    onChange({
      ...overrides,
      glassFinish: Object.keys(next).length > 0 ? next : undefined,
    });
  };
  const resetAll = () => {
    const { glassFinish: _, ...rest } = overrides;
    void _;
    onChange(rest);
  };
  const def = defaults.glassFinish;
  const overridden = !!overrides.glassFinish && Object.keys(overrides.glassFinish).length > 0;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs uppercase tracking-wider text-[#9ca3af] font-medium">
          Vitres
        </h3>
        {/* Debug toggle button — pill style, lights up red when active */}
        <button
          type="button"
          onClick={() => onToggleDebugGlass(!debugGlass)}
          className={
            'h-7 px-2 text-[10px] uppercase tracking-wider rounded-md font-medium ' +
            'transition-colors border ' +
            (debugGlass
              ? 'bg-[#e31937] border-[#e31937] text-white'
              : 'bg-[#1a1a1a] border-[#2a2a2a] text-[#9ca3af] hover:text-white')
          }
        >
          {debugGlass ? '● Debug actif' : 'Mode debug'}
        </button>
      </div>
      <p className="text-[10px] text-[#6b7280] -mt-2">
        Opacité, teinte, reflets des vitres. Le mode debug colore chaque
        pane pour identifier visuellement les sliders.
      </p>

      {debugGlass && (
        <div className="border border-[#3a1a1a] rounded-md bg-[#1a0a0a] p-2 space-y-1">
          <p className="text-[10px] uppercase tracking-wider text-[#fca5a5] font-medium">
            Légende debug
          </p>
          {DEBUG_LEGEND.map((row) => (
            <div key={row.label} className="flex items-center gap-2">
              <span
                className="w-3 h-3 rounded-sm border border-[#2a2a2a] shrink-0"
                style={{ backgroundColor: row.color }}
              />
              <span className="text-[11px] text-[#d4d4d4] font-mono w-24 shrink-0">
                {row.label}
              </span>
              <span className="text-[10px] text-[#9ca3af] truncate">{row.hint}</span>
            </div>
          ))}
        </div>
      )}

      <SubSection
        title="Outer (vitres extérieures)"
        defaultOpen
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
              ↺ Reset all
            </button>
          ) : null
        }
      >
        <ShowroomSlider
          label="EnvMul"
          value={gf.outerEnvMultiplier ?? def.outerEnvMultiplier}
          onChange={(n) => setField('outerEnvMultiplier', n)}
          defaultValue={def.outerEnvMultiplier}
          min={0}
          max={2}
          step={0.01}
          unit="x"
        />
        <p className="text-[10px] text-[#6b7280] -mt-1">
          Reflet ciel HDR sur les vitres. 0 = mat, 2 = miroir.
        </p>
        <ShowroomSlider
          label="WinOp"
          value={gf.outerWindowOpacity ?? def.outerWindowOpacity}
          onChange={(n) => setField('outerWindowOpacity', n)}
          defaultValue={def.outerWindowOpacity}
          min={0}
          max={1}
          step={0.01}
        />
        <ShowroomSlider
          label="WinTint"
          value={gf.outerWindowTint ?? def.outerWindowTint}
          onChange={(n) => setField('outerWindowTint', n)}
          defaultValue={def.outerWindowTint}
          min={0}
          max={1}
          step={0.01}
        />
        <ShowroomSlider
          label="RoofOp"
          value={gf.outerRoofOpacity ?? def.outerRoofOpacity}
          onChange={(n) => setField('outerRoofOpacity', n)}
          defaultValue={def.outerRoofOpacity}
          min={0}
          max={1}
          step={0.01}
        />
        <ShowroomSlider
          label="RoofTint"
          value={gf.outerRoofTint ?? def.outerRoofTint}
          onChange={(n) => setField('outerRoofTint', n)}
          defaultValue={def.outerRoofTint}
          min={0}
          max={1}
          step={0.01}
        />
        <p className="text-[10px] text-[#6b7280] -mt-1">
          Tint = scalaire multiplié dans la couleur (0 = noir, 1 = teinte
          GLB native). Roof = toit panoramique uniquement.
        </p>
      </SubSection>

      <SubSection title="Inner mixed (pare-brise inner)">
        <ShowroomSlider
          label="Opac"
          value={gf.innerMixedOpacity ?? def.innerMixedOpacity}
          onChange={(n) => setField('innerMixedOpacity', n)}
          defaultValue={def.innerMixedOpacity}
          min={0}
          max={0.5}
          step={0.005}
        />
        <ShowroomSlider
          label="EnvMul"
          value={gf.innerMixedEnvMultiplier ?? def.innerMixedEnvMultiplier}
          onChange={(n) => setField('innerMixedEnvMultiplier', n)}
          defaultValue={def.innerMixedEnvMultiplier}
          min={0}
          max={1}
          step={0.01}
          unit="x"
        />
        <p className="text-[10px] text-[#6b7280] -mt-1">
          Pane intérieur derrière l'outer (typique pare-brise + portes
          avant). Garder opacité très basse pour voir à travers.
        </p>
      </SubSection>

      <SubSection title="Inner solo (vitres arrière)">
        <ShowroomSlider
          label="EnvMul"
          value={gf.innerSoloEnvMultiplier ?? def.innerSoloEnvMultiplier}
          onChange={(n) => setField('innerSoloEnvMultiplier', n)}
          defaultValue={def.innerSoloEnvMultiplier}
          min={0}
          max={2}
          step={0.01}
          unit="x"
        />
        <p className="text-[10px] text-[#6b7280] -mt-1">
          Pane unique (Y rear doors). Le reflet EST ce qui rend l'effet
          "vitre teintée". Trop bas = panneau noir plat.
        </p>
      </SubSection>
    </section>
  );
}
