/**
 * Showroom — lights + ground projections calibration panel.
 *
 * Two sub-sections:
 *   1. PHARES — per-light (brake, reverse, headlight) emissive
 *      intensity slider + colour picker. These boost the corresponding
 *      meshes' material emissive when the car is in the matching
 *      driving state (D = brake+headlight, R = reverse).
 *
 *   2. PROJECTIONS AU SOL — per-beam (headlight, stoplight) colour +
 *      opacity + texture URL. Lets the user swap the Tesla default
 *      beam PNG for a custom one (e.g. a personalised welcome puddle
 *      light from the user's own asset CDN).
 *
 * Wiring: writes into `overrides.lightTuning` and `overrides.projections`
 * — both shallow-merged on top of `cfg.lightTuning` / `cfg.projections`
 * defaults in `mergeShowroomConfig`. The 3D viewer reads the resolved
 * values via `cfg.*` and re-renders the moment a slider moves.
 */
import { useState } from 'react';
import type { ShowroomOverrides } from './showroomOverrides';
import type { ProjectionConfig, VehicleModelConfig } from './vehicleModelConfig';
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
// PROJECTIONS — per-beam color + opacity + texture URL + renderOrder
// ────────────────────────────────────────────────────────────────────

interface BeamSlot {
  label: string;
  key: 'headlight' | 'stoplight';
  defaultHint: string;
}

const BEAM_SLOTS: BeamSlot[] = [
  {
    label: 'Faisceau avant',
    key: 'headlight',
    defaultHint: 'Texture par défaut : /textures/headlight_beam.png',
  },
  {
    label: 'Faisceau arrière',
    key: 'stoplight',
    defaultHint: 'Texture par défaut : /textures/stoplight_beam.png',
  },
];

function ProjectionsSection({ overrides, onChange, defaults }: Props) {
  const proj = overrides.projections ?? {};
  const setBeamField = <K extends keyof ProjectionConfig>(
    beamKey: 'headlight' | 'stoplight',
    field: K,
    value: ProjectionConfig[K] | undefined,
  ) => {
    const beam = { ...(proj[beamKey] ?? {}) };
    if (value === undefined || value === '') {
      delete beam[field];
    } else {
      beam[field] = value;
    }
    const nextProj = { ...proj };
    if (Object.keys(beam).length > 0) {
      nextProj[beamKey] = beam;
    } else {
      delete nextProj[beamKey];
    }
    onChange({
      ...overrides,
      projections: Object.keys(nextProj).length > 0 ? nextProj : undefined,
    });
  };
  const resetAll = () => {
    const { projections: _, ...rest } = overrides;
    void _;
    onChange(rest);
  };
  const overridden =
    !!overrides.projections && Object.keys(overrides.projections).length > 0;

  return (
    <SubSection
      title="Projections au sol"
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
        Overlay texturé sous la voiture (mode D/R). Couleur multipliée
        dans la texture (blanc = teinte d'origine).
      </p>
      {BEAM_SLOTS.map((slot) => {
        const def = defaults.projections[slot.key];
        const ov = proj[slot.key] ?? {};
        const color = ov.color ?? def.color;
        const opacity = ov.opacity ?? def.opacity;
        const renderOrder = ov.renderOrder ?? def.renderOrder;
        const textureUrl = ov.textureUrl ?? '';
        return (
          <div
            key={slot.key}
            className="border border-[#1a1a1a] rounded p-1.5 space-y-1.5"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] text-[#d4d4d4] font-medium truncate">
                {slot.label}
              </p>
              <ColorPicker
                value={color}
                onChange={(n) => setBeamField(slot.key, 'color', n)}
              />
            </div>
            <ShowroomSlider
              label="Opac"
              value={opacity}
              onChange={(n) => setBeamField(slot.key, 'opacity', n)}
              defaultValue={def.opacity}
              min={0}
              max={1}
              step={0.01}
            />
            <ShowroomSlider
              label="Order"
              value={renderOrder}
              onChange={(n) => setBeamField(slot.key, 'renderOrder', n)}
              defaultValue={def.renderOrder}
              min={-5}
              max={30}
              step={1}
            />
            <div className="space-y-0.5">
              <label className="text-[10px] uppercase tracking-wider text-[#9ca3af]">
                Texture URL (optionnel)
              </label>
              <input
                type="text"
                value={textureUrl}
                onChange={(e) =>
                  setBeamField(slot.key, 'textureUrl', e.target.value || undefined)
                }
                placeholder={def.textureUrl ?? slot.defaultHint}
                className="w-full h-7 bg-[#0a0a0a] border border-[#2a2a2a] rounded px-2 text-[11px] text-white focus:border-[#e31937] focus:outline-none font-mono"
              />
              <p className="text-[9px] text-[#4b5563] truncate">{slot.defaultHint}</p>
            </div>
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
        Phares de la voiture + projections au sol. Sauvegardé par voiture.
      </p>
      <LightsSection overrides={overrides} onChange={onChange} defaults={defaults} />
      <ProjectionsSection
        overrides={overrides}
        onChange={onChange}
        defaults={defaults}
      />
    </section>
  );
}
