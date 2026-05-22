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
import { useState, useRef } from 'react';
import type { ShowroomOverrides } from './showroomOverrides';
import type { VehicleModelConfig } from './vehicleModelConfig';
import { ShowroomSlider } from './ShowroomSlider';
import {
  useUploadShowroomWrap,
  useDeleteShowroomWrap,
  wrapPngUrl,
} from './useResolvedModelConfig';

interface Props {
  overrides: ShowroomOverrides;
  onChange: (next: ShowroomOverrides) => void;
  defaults: VehicleModelConfig;
}

interface WrapProps extends Props {
  /** Car id used to upload / delete / fetch the per-car PNG. The
   *  wrap is car-scoped on the backend so each vehicle can carry its
   *  own livery without interfering with siblings on the same account. */
  carId: number | undefined;
  /** True when the backend has a wrap PNG persisted for this car
   *  (sourced from `useResolvedModelConfig.wrapExists`). */
  wrapExists: boolean;
  /** Bust the browser cache for the wrap thumbnail after the user
   *  uploads / deletes — passed as `?v=…` query string. Usually the
   *  last `updatedAt` ISO timestamp. */
  cacheKey: string | null;
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
// WRAP — custom PNG body livery (upload + Tesla template gallery)
//
// Tesla's own configurator lets the user upload a 1024×1024 PNG via
// USB (Toybox → Paint Shop → Wraps) and applies it as the body
// material's baseColorTexture. We mirror that workflow in the
// Showroom: drag-and-drop a PNG (≤ 1 MB), it's POSTed to
// `/vehicle/{carId}/showroom/wrap`, the backend stores it as a
// bytea column, and the renderer fetches it back as a texture.
//
// When a wrap is active, the paint colour picker is hidden — wrap
// and solid colour are mutually exclusive (mixing them would tint
// the wrap colours unpredictably). The Tesla template gallery below
// the upload zone exposes a few official wraps from
// github.com/teslamotors/custom-wraps as one-click presets.
// ────────────────────────────────────────────────────────────────────

interface TeslaTemplate {
  /** Public URL (under /public/wraps/). */
  url: string;
  /** Display name (Tesla's own template name). */
  name: string;
  /** Which model the template targets — used to filter the gallery
   *  so the user doesn't see a Y template while configuring an M3. */
  modelKey: 'poppyseed' | 'bayberry';
}

const TESLA_TEMPLATES: ReadonlyArray<TeslaTemplate> = [
  // Wired in /public/wraps/* — see README of teslamotors/custom-wraps
  // for the source PNGs.
  { url: '/wraps/m3-classic.png',   name: 'M3 Classic',       modelKey: 'poppyseed' },
  { url: '/wraps/m3-camo.png',      name: 'M3 Camo',          modelKey: 'poppyseed' },
  { url: '/wraps/my-classic.png',   name: 'MY Classic',       modelKey: 'bayberry' },
  { url: '/wraps/my-stripes.png',   name: 'MY Stripes',       modelKey: 'bayberry' },
];

function WrapSection({
  overrides,
  onChange,
  defaults,
  carId,
  wrapExists,
  cacheKey,
}: WrapProps) {
  const uploadMutation = useUploadShowroomWrap(carId);
  const deleteMutation = useDeleteShowroomWrap(carId);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragHover, setDragHover] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // `paintTextureUrl` override wins over a server-uploaded wrap —
  // used by the template gallery to preview a stock PNG without
  // round-tripping through upload.
  const templateUrl = overrides.wraps?.paintTextureUrl;
  const hasWrap = !!templateUrl || (wrapExists && !!carId);
  const wrapKind: 'template' | 'upload' | null = templateUrl
    ? 'template'
    : wrapExists && carId
      ? 'upload'
      : null;
  // What URL to show in the preview thumbnail.
  const previewUrl =
    templateUrl ??
    (wrapExists && carId ? wrapPngUrl(carId, cacheKey ?? undefined) : null);

  const handleFiles = async (files: FileList | null) => {
    setErrorMsg(null);
    const file = files?.[0];
    if (!file) return;
    if (!file.type.includes('png') && !file.name.toLowerCase().endsWith('.png')) {
      setErrorMsg('Format invalide — PNG uniquement.');
      return;
    }
    if (file.size > 1024 * 1024) {
      setErrorMsg(`Fichier trop volumineux (${(file.size / 1024).toFixed(0)} KB > 1024 KB).`);
      return;
    }
    if (!carId) {
      setErrorMsg('Aucune voiture sélectionnée.');
      return;
    }
    try {
      await uploadMutation.mutateAsync(file);
      // If a template URL was previewed, clear it so the new upload wins.
      if (overrides.wraps?.paintTextureUrl) {
        const { wraps: _, ...rest } = overrides;
        void _;
        onChange(rest);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Upload échoué');
    }
  };

  const handleSelectTemplate = (url: string) => {
    setErrorMsg(null);
    onChange({
      ...overrides,
      wraps: { ...(overrides.wraps ?? {}), paintTextureUrl: url },
    });
  };

  const handleRemoveTemplate = () => {
    const { wraps: _, ...rest } = overrides;
    void _;
    onChange(rest);
  };

  const handleRemoveUpload = async () => {
    setErrorMsg(null);
    if (!carId) return;
    try {
      await deleteMutation.mutateAsync();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Suppression échouée');
    }
  };

  const activeModelKey = (defaults.key as 'poppyseed' | 'bayberry') ?? 'poppyseed';
  const templatesForModel = TESLA_TEMPLATES.filter((t) => t.modelKey === activeModelKey);

  return (
    <SubSection
      title="Wrap (livrée custom)"
      defaultOpen={hasWrap}
      rightSlot={
        hasWrap ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (wrapKind === 'template') {
                handleRemoveTemplate();
              } else {
                void handleRemoveUpload();
              }
            }}
            className="text-[10px] text-[#6b7280] hover:text-red-400"
          >
            ↺ Retirer
          </button>
        ) : null
      }
    >
      <p className="text-[10px] text-[#6b7280] -mt-1">
        Remplace la peinture par une image PNG appliquée sur la
        carrosserie (matériau Paint uniquement — pas les parties
        mates). Format Tesla : 1024×1024 max, 1 MB max.
      </p>

      {/* Preview thumbnail when a wrap is active */}
      {previewUrl && (
        <div className="flex items-center gap-2 p-2 bg-[#0a0a0a] border border-[#2a2a2a] rounded-md">
          <img
            src={previewUrl}
            alt="Wrap"
            className="w-14 h-14 rounded object-cover border border-[#2a2a2a]"
            style={{ background: '#181818' }}
          />
          <div className="flex-1 min-w-0">
            <p className="text-[11px] text-white truncate">
              {wrapKind === 'template' ? 'Template Tesla' : 'PNG uploadé'}
            </p>
            <p className="text-[10px] text-[#6b7280] truncate">
              {wrapKind === 'template'
                ? previewUrl.split('/').pop()
                : 'Désactive le picker couleur peinture.'}
            </p>
          </div>
        </div>
      )}

      {/* Drag & drop upload zone — always visible so the user can
          replace the current wrap by dropping a new PNG. */}
      {carId ? (
        <label
          onDragOver={(e) => {
            e.preventDefault();
            setDragHover(true);
          }}
          onDragLeave={() => setDragHover(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragHover(false);
            void handleFiles(e.dataTransfer.files);
          }}
          className={
            'flex flex-col items-center justify-center gap-1 p-3 rounded-md border-2 border-dashed cursor-pointer transition-colors ' +
            (dragHover
              ? 'border-[#e31937] bg-[#e31937]/5'
              : 'border-[#2a2a2a] hover:border-[#3a3a3a] bg-[#0a0a0a]')
          }
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png"
            className="hidden"
            onChange={(e) => void handleFiles(e.target.files)}
          />
          <p className="text-[11px] text-[#d4d4d4]">
            {uploadMutation.isPending
              ? 'Envoi en cours…'
              : wrapExists
                ? 'Glisse un nouveau PNG pour remplacer'
                : 'Glisse un PNG ici ou clique pour parcourir'}
          </p>
          <p className="text-[10px] text-[#6b7280]">PNG · max 1 MB · 1024×1024 recommandé</p>
        </label>
      ) : (
        <p className="text-[10px] text-[#6b7280] italic">
          Sélectionne une voiture pour uploader un wrap.
        </p>
      )}

      {errorMsg && (
        <p className="text-[10px] text-red-400 px-1">⚠ {errorMsg}</p>
      )}

      {/* Tesla official templates — one-click presets */}
      {templatesForModel.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] uppercase tracking-wider text-[#6b7280]">
            Templates Tesla officiels
          </p>
          <div className="grid grid-cols-4 gap-1">
            {templatesForModel.map((tpl) => {
              const active = templateUrl === tpl.url;
              return (
                <button
                  key={tpl.url}
                  type="button"
                  onClick={() => handleSelectTemplate(tpl.url)}
                  title={tpl.name}
                  className={
                    'aspect-square rounded transition-all overflow-hidden ' +
                    (active
                      ? 'ring-2 ring-[#e31937] ring-offset-1 ring-offset-[#141414]'
                      : 'hover:ring-1 hover:ring-white')
                  }
                  style={{ backgroundColor: '#181818' }}
                >
                  <img
                    src={tpl.url}
                    alt={tpl.name}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      // Hide the broken image silently — the template
                      // PNG hasn't been bundled in /public/wraps/ yet.
                      (e.currentTarget as HTMLImageElement).style.opacity = '0.3';
                    }}
                  />
                </button>
              );
            })}
          </div>
        </div>
      )}
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

interface AestheticsProps extends Props {
  /** Car id — required for wrap upload/delete (per-car PNG endpoint). */
  carId: number | undefined;
  /** True when the backend has a wrap PNG persisted for this car. */
  wrapExists: boolean;
  /** Cache bust for the wrap thumbnail after upload — pass last
   *  `updatedAt` ISO string. */
  cacheKey: string | null;
}

export function ShowroomAestheticsSection({
  overrides,
  onChange,
  defaults,
  carId,
  wrapExists,
  cacheKey,
}: AestheticsProps) {
  // Wrap and solid paint are mutually exclusive. When a wrap is active
  // (template OR uploaded), hide the paint colour picker — its picker
  // would be visually meaningless (the wrap overrides the colour).
  const wrapActive =
    !!overrides.wraps?.paintTextureUrl || (wrapExists && !!carId);

  return (
    <section className="space-y-3">
      <h3 className="text-xs uppercase tracking-wider text-[#9ca3af] font-medium">
        Esthétique
      </h3>
      <p className="text-[10px] text-[#6b7280] -mt-2">
        Configuration (trim, conduite, marché, audio), wrap / peinture,
        intérieur, finition des jantes. Sauvegardé par voiture.
      </p>
      <VariantAxesSection overrides={overrides} onChange={onChange} defaults={defaults} />
      <WrapSection
        overrides={overrides}
        onChange={onChange}
        defaults={defaults}
        carId={carId}
        wrapExists={wrapExists}
        cacheKey={cacheKey}
      />
      {!wrapActive && (
        <PaintSection overrides={overrides} onChange={onChange} defaults={defaults} />
      )}
      <InteriorSection overrides={overrides} onChange={onChange} defaults={defaults} />
      <WheelsSection overrides={overrides} onChange={onChange} defaults={defaults} />
    </section>
  );
}
