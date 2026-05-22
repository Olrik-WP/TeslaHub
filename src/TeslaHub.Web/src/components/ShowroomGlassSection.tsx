/**
 * Showroom — window glass calibration panel.
 *
 * Tesla's exported GLBs split body glass into three calibration zones,
 * each with its own opacity / tint slider:
 *
 *   - **Door windows** (4 panes)           — Window_(L|R)[FR] on M3, Window_(FL|FR|RL|RR) on Y
 *   - **Panoramic roof + windshield**      — Windows_Top on M3, Fade on Y
 *   - **Trunk hatch outer glass** (Y only) — Trunk_Cover_Main
 *
 * Plus two inner-pane zones for the cabin-side layers Tesla layers
 * behind every outer pane:
 *
 *   - **Inner mixed** — pane sitting BEHIND an outer one (windshield
 *     + front-door inner). Dampened to a faint veil so we can see
 *     through the windshield.
 *   - **Inner solo** — pane that is the ONLY layer on the mesh
 *     (Y rear-door privacy glass).
 *
 * The "Mode debug" toggle colour-codes every glass mesh by its zone /
 * role so the user knows which slider affects which pane.
 *
 * Wiring:
 *   - Numeric sliders write into `overrides.glassFinish` (saved).
 *   - Debug toggle is EPHEMERAL — wired through a parent-owned
 *     `debugFlags` state and passed to `<VehicleTopView3D debugMode>`.
 *   - Trunk-glass section is hidden on models without a
 *     `glassZoning.trunkGlassNode` (M3 bundles its lunette into the
 *     pano mesh, so a separate slider would be misleading).
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
  { color: '#ff0000', label: 'Outer', hint: 'Door windows, panoramic roof, windshield, trunk' },
  { color: '#0066ff', label: 'Inner mixed', hint: 'Cabin pane behind outer (windshield inner)' },
  { color: '#00ff66', label: 'Inner solo', hint: 'Y rear privacy glass (no outer behind)' },
  { color: '#ff8800', label: 'NOMAT glass', hint: 'Y windshield prim shipped without material' },
  { color: '#ff00ff', label: 'NOMAT privacy', hint: 'Y rear-door privacy glass placeholder' },
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
  const hasTrunkGlass = !!defaults.glassZoning.trunkGlassNode;

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
        Chaque zone (portes, toit panoramique, lunette coffre) a ses
        propres sliders. Le mode debug colore chaque pane pour
        identifier visuellement les sliders.
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
        title="Global"
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
          Reflet ciel HDR sur TOUTES les vitres extérieures. 0 = mat,
          2 = miroir. Affecte aussi le pane privacy.
        </p>
      </SubSection>

      <SubSection title="Portes (4 vitres latérales)" defaultOpen>
        <ShowroomSlider
          label="Opac"
          value={gf.doorWindowOpacity ?? def.doorWindowOpacity}
          onChange={(n) => setField('doorWindowOpacity', n)}
          defaultValue={def.doorWindowOpacity}
          min={0}
          max={1}
          step={0.01}
        />
        <ShowroomSlider
          label="Tint"
          value={gf.doorWindowTint ?? def.doorWindowTint}
          onChange={(n) => setField('doorWindowTint', n)}
          defaultValue={def.doorWindowTint}
          min={0}
          max={1}
          step={0.01}
        />
        <p className="text-[10px] text-[#6b7280] -mt-1">
          Vitres des 4 portes uniquement. Tint = 0 noir, 1 = teinte
          GLB native.
        </p>
      </SubSection>

      <SubSection title="Toit panoramique + pare-brise" defaultOpen>
        <ShowroomSlider
          label="Opac"
          value={gf.panoroofOpacity ?? def.panoroofOpacity}
          onChange={(n) => setField('panoroofOpacity', n)}
          defaultValue={def.panoroofOpacity}
          min={0}
          max={1}
          step={0.01}
        />
        <ShowroomSlider
          label="Tint"
          value={gf.panoroofTint ?? def.panoroofTint}
          onChange={(n) => setField('panoroofTint', n)}
          defaultValue={def.panoroofTint}
          min={0}
          max={1}
          step={0.01}
        />
        <p className="text-[10px] text-[#6b7280] -mt-1">
          M3 : Windows_Top (toit + pare-brise + lunette + custodes
          fusionnés). Y : Fade (toit + pare-brise + lunette).
        </p>
      </SubSection>

      {hasTrunkGlass && (
        <SubSection title="Lunette coffre">
          <ShowroomSlider
            label="Opac"
            value={gf.trunkGlassOpacity ?? def.trunkGlassOpacity}
            onChange={(n) => setField('trunkGlassOpacity', n)}
            defaultValue={def.trunkGlassOpacity}
            min={0}
            max={1}
            step={0.01}
          />
          <ShowroomSlider
            label="Tint"
            value={gf.trunkGlassTint ?? def.trunkGlassTint}
            onChange={(n) => setField('trunkGlassTint', n)}
            defaultValue={def.trunkGlassTint}
            min={0}
            max={1}
            step={0.01}
          />
          <p className="text-[10px] text-[#6b7280] -mt-1">
            Y uniquement (Trunk_Cover_Main). Sur M3 la lunette est
            dans le toit panoramique.
          </p>
        </SubSection>
      )}

      <SubSection title="Inner mixed (pane derrière outer)">
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
          Pane intérieur derrière l'outer (pare-brise + portes avant).
          Garder opacité très basse pour voir à travers.
        </p>
      </SubSection>

      <SubSection title="Inner solo (privacy arrière Y)">
        <ShowroomSlider
          label="Opac"
          value={gf.innerSoloOpacity ?? def.innerSoloOpacity}
          onChange={(n) => setField('innerSoloOpacity', n)}
          defaultValue={def.innerSoloOpacity}
          min={0}
          max={1}
          step={0.01}
        />
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
          Pane unique (vitres arrière Y privacy). Le reflet EST ce qui
          rend l'effet "vitre teintée" — trop bas = panneau noir plat.
        </p>
      </SubSection>
    </section>
  );
}
