/**
 * Showroom — lights calibration panel (per-light emissive boost).
 *
 * One sub-section: PHARES — per-light (brake, reverse, headlight)
 * emissive intensity slider + colour picker. These boost the
 * corresponding meshes' material emissive when the car is in the
 * matching driving state (D = brake+headlight, R = reverse).
 *
 * Ground projections were removed from the Showroom — the runtime no
 * longer touches the projection materials (the Tesla beam is baked
 * into every GLB). Visibility is still toggled by `useGroundProjections`
 * based on shift state.
 *
 * Wiring: writes into `overrides.lightTuning`, shallow-merged on top
 * of `cfg.lightTuning` in `mergeShowroomConfig`. The 3D viewer reads
 * the resolved values via `cfg.lightTuning` and re-renders the moment
 * a slider moves.
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

const hexToString = (n: number): string =>
  '#' + n.toString(16).padStart(6, '0').slice(-6);
const stringToHex = (s: string): number => {
  const m = /^#?([0-9a-f]{6})$/i.exec(s);
  return m ? parseInt(m[1], 16) : 0;
};

// ────────────────────────────────────────────────────────────────────
// Sub-section helper
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
// Single colour picker row (compact — re-implemented here to keep this
// section self-contained without leaking ColorRow from aesthetics).
// ────────────────────────────────────────────────────────────────────

function ColorPicker({
  value,
  onChange,
}: {
  value: number;
  onChange: (next: number) => void;
}) {
  return (
    <div className="flex items-center gap-1">
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
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// PHARES — intensity slider + colour for brake / reverse / headlight
// ────────────────────────────────────────────────────────────────────

interface LightSlot {
  /** UI label (translated by the caller; here we use fr default). */
  label: string;
  /** Subtitle / hint describing WHEN this light fires. */
  hint: string;
  /** Field name on `lightTuning` carrying the intensity. */
  intensityKey: 'brakeIntensity' | 'reverseIntensity' | 'headlightIntensity';
  /** Field name on `lightTuning` carrying the colour hex. */
  colorKey: 'brakeColor' | 'reverseColor' | 'headlightColor';
}

const LIGHT_SLOTS: LightSlot[] = [
  {
    label: 'Phares avant',
    hint: 'Marche D (DRL + croisement)',
    intensityKey: 'headlightIntensity',
    colorKey: 'headlightColor',
  },
  {
    label: 'Feux stop',
    hint: 'Marche D (pédale relâchée déjà = freinage visuel)',
    intensityKey: 'brakeIntensity',
    colorKey: 'brakeColor',
  },
  {
    label: 'Feux de recul',
    hint: 'Marche R',
    intensityKey: 'reverseIntensity',
    colorKey: 'reverseColor',
  },
];

function LightsSection({ overrides, onChange, defaults }: Props) {
  const lt = overrides.lightTuning ?? {};
  const setField = <K extends keyof VehicleModelConfig['lightTuning']>(
    key: K,
    value: VehicleModelConfig['lightTuning'][K] | undefined,
  ) => {
    const next = { ...lt };
    if (value === undefined) {
      delete next[key];
    } else {
      next[key] = value;
    }
    onChange({
      ...overrides,
      lightTuning: Object.keys(next).length > 0 ? next : undefined,
    });
  };
  const resetAll = () => {
    const { lightTuning: _, ...rest } = overrides;
    void _;
    onChange(rest);
  };
  const overridden = !!overrides.lightTuning && Object.keys(overrides.lightTuning).length > 0;

  return (
    <SubSection
      title="Phares & feux"
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
            ↺ Reset
          </button>
        ) : null
      }
    >
      <p className="text-[10px] text-[#6b7280] -mt-1">
        Boost émissif appliqué aux maillages d'éclairage quand l'état de
        conduite correspond. 0 = éteint, 5 = vif.
      </p>
      {LIGHT_SLOTS.map((slot) => {
        const intensity = lt[slot.intensityKey] ?? defaults.lightTuning[slot.intensityKey];
        const color = lt[slot.colorKey] ?? defaults.lightTuning[slot.colorKey];
        return (
          <div
            key={slot.intensityKey}
            className="border border-[#1a1a1a] rounded p-1.5 space-y-1.5"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[11px] text-[#d4d4d4] font-medium truncate">
                  {slot.label}
                </p>
                <p className="text-[9px] text-[#6b7280] truncate">{slot.hint}</p>
              </div>
              <ColorPicker
                value={color}
                onChange={(n) => setField(slot.colorKey, n)}
              />
            </div>
            <ShowroomSlider
              label="Boost"
              value={intensity}
              onChange={(n) => setField(slot.intensityKey, n)}
              defaultValue={defaults.lightTuning[slot.intensityKey]}
              min={0}
              max={5}
              step={0.05}
              unit="x"
            />
          </div>
        );
      })}
    </SubSection>
  );
}

// ────────────────────────────────────────────────────────────────────
// Aggregator
// ────────────────────────────────────────────────────────────────────

export function ShowroomLightsSection({ overrides, onChange, defaults }: Props) {
  return (
    <section className="space-y-3">
      <h3 className="text-xs uppercase tracking-wider text-[#9ca3af] font-medium">
        Éclairage
      </h3>
      <p className="text-[10px] text-[#6b7280] -mt-2">
        Boost émissif des phares (mode D/R). Sauvegardé par voiture.
      </p>
      <LightsSection overrides={overrides} onChange={onChange} defaults={defaults} />
    </section>
  );
}
