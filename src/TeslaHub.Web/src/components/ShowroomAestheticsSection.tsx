/**
 * Showroom — aesthetics calibration panel.
 *
 * Visual chrome that goes BEYOND geometry: body paint colour, interior
 * placeholder repaints (Decor / cupholder / Wing on the Y), and the
 * wheel material polish (roughness, env boost, tint).
 *
 * Like the geometry section, every change writes into the in-flight
 * `ShowroomOverrides` blob — no API call until the user hits Save.
 *
 * Notes:
 *   - `bodyPaintColor` and `interiorColors` are RGB hex integers in
 *     the override blob, but the HTML <input type="color"> works in
 *     #rrggbb. The Color helpers below convert in both directions.
 *   - The interior section is only shown when the active model has
 *     `interiorOverrides` defined (M3 Highland doesn't; Y Bayberry
 *     does). Otherwise the section is hidden entirely so the user
 *     isn't tempted to set colours that go nowhere.
 *   - The wheel finish section shows a tint colour picker WITH a
 *     "Tesla default" checkbox: ticking it removes the tint override
 *     so the GLB's native chrome shows through, untouched.
 */
import { useState } from 'react';
import type { ShowroomOverrides } from './showroomOverrides';
import type { VehicleModelConfig } from './vehicleModelConfig';
import { ShowroomSlider } from './ShowroomSlider';

interface Props {
  overrides: ShowroomOverrides;
  onChange: (next: ShowroomOverrides) => void;
  defaults: VehicleModelConfig;
}

// ────────────────────────────────────────────────────────────────────
// Color hex helpers
// ────────────────────────────────────────────────────────────────────

const hexToString = (n: number): string =>
  '#' + n.toString(16).padStart(6, '0').slice(-6);

const stringToHex = (s: string): number => {
  const m = /^#?([0-9a-f]{6})$/i.exec(s);
  return m ? parseInt(m[1], 16) : 0;
};

// Tesla's official body colour palette — used as preset swatches above
// the colour picker so the user can hit a "real" Tesla colour in one
// click. Numbers come from the Tesla configurator (eyeballed in
// screenshots, exact paint chips are proprietary).
const TESLA_PAINTS: Array<{ name: string; hex: number }> = [
  { name: 'Pearl White Multi-Coat', hex: 0xf2f2f0 },
  { name: 'Solid Black', hex: 0x0e0e0e },
  { name: 'Midnight Silver Metallic', hex: 0x5a5a5a },
  { name: 'Deep Blue Metallic', hex: 0x1b3a5c },
  { name: 'Ultra Red', hex: 0xa82323 },
  { name: 'Quicksilver', hex: 0xa8a8a8 },
  { name: 'Stealth Grey', hex: 0x3a3d40 },
];

// ────────────────────────────────────────────────────────────────────
// Sub-section helper (same chevron pattern as Geometry section)
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
// Color picker row (label + swatch + native picker + hex input + ↺)
// ────────────────────────────────────────────────────────────────────

interface ColorRowProps {
  label: string;
  value: number;
  onChange: (next: number | undefined) => void;
  /** Default value the ↺ button resets to. */
  defaultValue: number;
  /** When `value === defaultValue` (and not explicitly overridden via
   *  parent state), the ↺ button is hidden. */
  isOverridden: boolean;
}

function ColorRow({ label, value, onChange, defaultValue, isOverridden }: ColorRowProps) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 min-w-0">
        <p className="text-[10px] uppercase tracking-wider text-[#9ca3af] font-mono truncate">
          {label}
        </p>
      </div>
      <input
        type="color"
        value={hexToString(value)}
        onChange={(e) => onChange(stringToHex(e.target.value))}
        className="w-7 h-7 rounded cursor-pointer bg-[#0a0a0a] border border-[#2a2a2a]"
        style={{ padding: 0 }}
      />
      <input
        type="text"
        value={hexToString(value).toUpperCase()}
        onChange={(e) => {
          const n = stringToHex(e.target.value);
          if (n || e.target.value === '#000000') onChange(n);
        }}
        className="w-20 h-6 bg-[#0a0a0a] border border-[#2a2a2a] rounded px-1.5 text-[11px] text-right font-mono text-white focus:border-[#e31937] focus:outline-none"
      />
      {isOverridden ? (
        <button
          type="button"
          onClick={() => onChange(undefined)}
          title={`Réinitialiser à ${hexToString(defaultValue).toUpperCase()}`}
          className="w-5 h-5 flex items-center justify-center text-[10px] rounded text-[#6b7280] hover:text-white hover:bg-[#2a2a2a]"
        >
          ↺
        </button>
      ) : (
        <span className="w-5" />
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// VARIANTS — generic multi-axis configurator
//   Tesla packs every trim / drive layout / market region / audio
//   package into one GLB by shipping duplicate overlapping meshes.
//   Each axis declared on the model renders as an independent button
//   group; the user picks one option per axis. Storage:
//   `overrides.variants = { axisId -> optionId }`. We omit any axis
//   whose chosen option matches the axis default so the saved blob
//   stays minimal (it survives axis-default changes shipped later).
// ────────────────────────────────────────────────────────────────────

function VariantAxesSection({ overrides, onChange, defaults }: Props) {
  const axes = defaults.variantAxes;
  if (!axes || axes.length === 0) return null;

  const setAxisOption = (axisId: string, optionId: string, defaultOption: string) => {
    const next = { ...(overrides.variants ?? {}) };
    if (optionId === defaultOption) {
      delete next[axisId];
    } else {
      next[axisId] = optionId;
    }
    onChange({
      ...overrides,
      variants: Object.keys(next).length > 0 ? next : undefined,
    });
  };

  const resetAll = () => {
    const { variants: _, ...rest } = overrides;
    void _;
    onChange(rest);
  };

  const anyOverridden =
    !!overrides.variants && Object.keys(overrides.variants).length > 0;

  return (
    <SubSection
      title="Configuration"
      defaultOpen
      rightSlot={
        anyOverridden ? (
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
        Tesla packe trim, conduite (LHD/RHD), marché (EU/US) et options
        dans le même GLB. Chaque choix masque les pièces dupliquées de
        l'autre variante pour éviter le z-fighting (double volant,
        deux plaques, etc.).
      </p>
      {axes.map((axis) => {
        const activeId =
          overrides.variants?.[axis.id] ?? axis.defaultOption;
        return (
          <div key={axis.id} className="space-y-1">
            <p className="text-[10px] uppercase tracking-wider text-[#9ca3af] font-mono">
              {axis.label}
            </p>
            <div
              className="grid gap-1.5"
              style={{
                gridTemplateColumns: `repeat(${Math.min(axis.options.length, 3)}, minmax(0, 1fr))`,
              }}
            >
              {axis.options.map((opt) => {
                const active = opt.id === activeId;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() =>
                      setAxisOption(axis.id, opt.id, axis.defaultOption)
                    }
                    className={
                      'h-9 px-2 text-[11px] rounded-md border transition-colors ' +
                      (active
                        ? 'bg-[#e31937] border-[#e31937] text-white font-medium'
                        : 'bg-[#0a0a0a] border-[#2a2a2a] text-[#d4d4d4] hover:border-[#3a3a3a]')
                    }
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </SubSection>
  );
}

// ────────────────────────────────────────────────────────────────────
// PEINTURE — body paint colour with Tesla preset swatches
// ────────────────────────────────────────────────────────────────────

function PaintSection({ overrides, onChange, defaults }: Props) {
  const current = overrides.bodyPaintColor ?? defaults.bodyPaintColor;
  const setColor = (next: number | undefined) => {
    if (next === undefined) {
      const { bodyPaintColor: _, ...rest } = overrides;
      void _;
      onChange(rest);
    } else {
      onChange({ ...overrides, bodyPaintColor: next });
    }
  };

  return (
    <SubSection title="Peinture" defaultOpen>
      <ColorRow
        label="Carrosserie"
        value={current}
        onChange={setColor}
        defaultValue={defaults.bodyPaintColor}
        isOverridden={overrides.bodyPaintColor !== undefined}
      />
      <div>
        <p className="text-[10px] uppercase tracking-wider text-[#6b7280] mb-1">
          Palette Tesla
        </p>
        <div className="grid grid-cols-7 gap-1">
          {TESLA_PAINTS.map((p) => {
            const active = current === p.hex;
            return (
              <button
                key={p.hex}
                type="button"
                onClick={() => setColor(p.hex)}
                title={p.name}
                className={
                  'aspect-square rounded transition-all ' +
                  (active
                    ? 'ring-2 ring-[#e31937] ring-offset-1 ring-offset-[#141414]'
                    : 'hover:ring-1 hover:ring-white')
                }
                style={{ backgroundColor: hexToString(p.hex) }}
              />
            );
          })}
        </div>
      </div>
    </SubSection>
  );
}

// ────────────────────────────────────────────────────────────────────
// INTÉRIEUR — per-slot colour overrides (only when model defines slots)
// ────────────────────────────────────────────────────────────────────

function InteriorSection({ overrides, onChange, defaults }: Props) {
  const slots = defaults.interiorOverrides ?? [];
  if (slots.length === 0) return null;

  const setSlot = (key: string, next: number | undefined) => {
    const map = { ...(overrides.interiorColors ?? {}) };
    if (next === undefined) {
      delete map[key];
    } else {
      map[key] = next;
    }
    onChange({
      ...overrides,
      interiorColors: Object.keys(map).length > 0 ? map : undefined,
    });
  };

  const resetAll = () => {
    const { interiorColors: _, ...rest } = overrides;
    void _;
    onChange(rest);
  };
  const anyOverridden =
    overrides.interiorColors && Object.keys(overrides.interiorColors).length > 0;

  return (
    <SubSection
      title="Intérieur"
      rightSlot={
        anyOverridden ? (
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
        Repeint les matériaux placeholders Tesla — sièges, panneaux
        de portes (Decor), inserts. Visibles à travers les vitres.
      </p>
      {slots.map((slot) => {
        const override = overrides.interiorColors?.[slot.key];
        return (
          <ColorRow
            key={slot.key}
            label={slot.key}
            value={override ?? slot.color}
            onChange={(next) => setSlot(slot.key, next)}
            defaultValue={slot.color}
            isOverridden={override !== undefined}
          />
        );
      })}
    </SubSection>
  );
}

// ────────────────────────────────────────────────────────────────────
// JANTES — alloy roughness / envBoost / tint + plastic finish
// ────────────────────────────────────────────────────────────────────

function WheelsSection({ overrides, onChange, defaults }: Props) {
  const wf = overrides.wheelFinish ?? {};
  const setField = <K extends keyof VehicleModelConfig['wheelFinish']>(
    key: K,
    value: VehicleModelConfig['wheelFinish'][K] | undefined,
  ) => {
    const next = { ...wf };
    if (value === undefined) {
      delete next[key];
    } else {
      next[key] = value;
    }
    onChange({
      ...overrides,
      wheelFinish: Object.keys(next).length > 0 ? next : undefined,
    });
  };
  const resetAll = () => {
    const { wheelFinish: _, ...rest } = overrides;
    void _;
    onChange(rest);
  };
  const def = defaults.wheelFinish;
  const alloyRoughness = wf.alloyRoughnessMin ?? def.alloyRoughnessMin;
  const alloyEnvBoost = wf.alloyEnvBoost ?? def.alloyEnvBoost;
  const alloyTint = wf.alloyTint ?? def.alloyTint;
  const plasticRoughness = wf.plasticRoughness ?? def.plasticRoughness;
  const plasticEnvBoost = wf.plasticEnvBoost ?? def.plasticEnvBoost;
  const overridden = !!overrides.wheelFinish && Object.keys(overrides.wheelFinish).length > 0;

  return (
    <SubSection
      title="Jantes (finition)"
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
      <p className="text-[10px] uppercase tracking-wider text-[#6b7280]">
        Alliage (centre + branches)
      </p>
      <ShowroomSlider
        label="Rough"
        value={alloyRoughness}
        onChange={(n) => setField('alloyRoughnessMin', n)}
        defaultValue={def.alloyRoughnessMin}
        min={0}
        max={1}
        step={0.01}
      />
      <ShowroomSlider
        label="EnvBoost"
        value={alloyEnvBoost}
        onChange={(n) => setField('alloyEnvBoost', n)}
        defaultValue={def.alloyEnvBoost}
        min={0}
        max={3}
        step={0.05}
        unit="x"
      />
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-[10px] uppercase tracking-wider text-[#9ca3af] font-mono truncate">
            Teinte
          </p>
        </div>
        <input
          type="color"
          value={hexToString(alloyTint ?? 0xffffff)}
          onChange={(e) => setField('alloyTint', stringToHex(e.target.value))}
          className="w-7 h-7 rounded cursor-pointer bg-[#0a0a0a] border border-[#2a2a2a]"
          style={{ padding: 0 }}
          disabled={alloyTint === undefined}
        />
        <label className="flex items-center gap-1 text-[10px] text-[#9ca3af] select-none cursor-pointer">
          <input
            type="checkbox"
            checked={alloyTint === undefined}
            onChange={(e) =>
              setField('alloyTint', e.target.checked ? undefined : 0xc0c0c0)
            }
            className="accent-[#e31937] cursor-pointer"
          />
          Native (GLB)
        </label>
      </div>
      <p className="text-[10px] text-[#6b7280] -mt-1">
        Native = couleur d'origine du GLB. Décoche pour appliquer une
        teinte (jante noire, dorée, bronze…).
      </p>

      <p className="text-[10px] uppercase tracking-wider text-[#6b7280] pt-1">
        Plastique (caches/pneu)
      </p>
      <ShowroomSlider
        label="Rough"
        value={plasticRoughness}
        onChange={(n) => setField('plasticRoughness', n)}
        defaultValue={def.plasticRoughness}
        min={0}
        max={1}
        step={0.01}
      />
      <ShowroomSlider
        label="EnvBoost"
        value={plasticEnvBoost}
        onChange={(n) => setField('plasticEnvBoost', n)}
        defaultValue={def.plasticEnvBoost}
        min={0}
        max={3}
        step={0.05}
        unit="x"
      />
    </SubSection>
  );
}

// ────────────────────────────────────────────────────────────────────
// Aggregator
// ────────────────────────────────────────────────────────────────────

export function ShowroomAestheticsSection({ overrides, onChange, defaults }: Props) {
  return (
    <section className="space-y-3">
      <h3 className="text-xs uppercase tracking-wider text-[#9ca3af] font-medium">
        Esthétique
      </h3>
      <p className="text-[10px] text-[#6b7280] -mt-2">
        Configuration (trim, conduite, marché, audio), peinture,
        intérieur, finition des jantes. Sauvegardé par voiture.
      </p>
      <VariantAxesSection overrides={overrides} onChange={onChange} defaults={defaults} />
      <PaintSection overrides={overrides} onChange={onChange} defaults={defaults} />
      <InteriorSection overrides={overrides} onChange={onChange} defaults={defaults} />
      <WheelsSection overrides={overrides} onChange={onChange} defaults={defaults} />
    </section>
  );
}
