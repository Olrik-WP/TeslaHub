/**
 * Showroom — Sentry camera placement.
 *
 * Lets the user position the pulsing "Sentry" dots that the 3D viewer
 * renders when Sentry mode is active. Tesla GLBs ship NO anchor nodes
 * for the cameras, so the positions are hand-placed world coordinates
 * (body-relative metres). This is the first per-camera editor — every
 * model (including the community fallback, which ships an EMPTY array)
 * can now build its own camera layout here.
 *
 * The whole `sentryCameraPositions` array is replaced on every edit
 * (the geometry is tightly coupled, so a per-field merge would be
 * confusing). Removing the override entirely reverts to the model's
 * shipped default layout.
 */
import { useTranslation } from 'react-i18next';
import { ShowroomVec3Slider } from './ShowroomSlider';
import type { ShowroomOverrides } from './showroomOverrides';
import type { VehicleModelConfig } from './vehicleModelConfig';
import type { ShowroomVisualState } from './showroomVisualState';

interface Props {
  overrides: ShowroomOverrides;
  onChange: (next: ShowroomOverrides) => void;
  defaults: VehicleModelConfig;
  /** Preview visual state — used to flip Sentry ON so the dots show. */
  visualState: ShowroomVisualState;
  onVisualChange: (next: ShowroomVisualState) => void;
}

type Vec3 = [number, number, number];

export function ShowroomSentrySection({
  overrides,
  onChange,
  defaults,
  visualState,
  onVisualChange,
}: Props) {
  const { t } = useTranslation();

  // Active list = user override if present, else the model default.
  const positions: ReadonlyArray<Vec3> =
    overrides.sentryCameraPositions ?? defaults.sentryCameraPositions;

  const setPositions = (next: ReadonlyArray<Vec3>) => {
    onChange({
      ...overrides,
      sentryCameraPositions: next.map((p) => [...p] as Vec3),
    });
  };

  const updateOne = (idx: number, v: Vec3) => {
    const next = positions.map((p, i) => (i === idx ? v : p));
    setPositions(next);
  };

  const addOne = () => {
    // Drop a new dot at a neutral, easy-to-find spot on the roof centre
    // so the user immediately sees it and drags it into place.
    setPositions([...positions, [0, 1.3, 0]]);
  };

  const removeOne = (idx: number) => {
    setPositions(positions.filter((_, i) => i !== idx));
  };

  const resetToDefault = () => {
    const { sentryCameraPositions: _drop, ...rest } = overrides;
    void _drop;
    onChange(rest);
  };

  const isOverridden = overrides.sentryCameraPositions !== undefined;
  const sentryPreviewOn = visualState.sentryMode === true;

  return (
    <section className="space-y-2">
      <header className="flex items-center justify-between">
        <h3 className="text-xs uppercase tracking-wider text-[#9ca3af] font-medium">
          {t('showroom.sections.sentry', 'Sentinelles')}
        </h3>
        {isOverridden && (
          <button
            type="button"
            onClick={resetToDefault}
            className="text-[10px] text-[#6b7280] hover:text-white"
            title={t('showroom.resetField', 'Revenir aux valeurs par défaut')}
          >
            {t('showroom.auto', 'Auto')}
          </button>
        )}
      </header>

      {/* Toggle the preview so the user can SEE the pulsing dots while
          placing them. Purely a preview convenience — never persisted. */}
      <label className="flex items-center gap-2 text-[11px] text-[#d1d5db] cursor-pointer select-none">
        <input
          type="checkbox"
          checked={sentryPreviewOn}
          onChange={(e) =>
            onVisualChange({ ...visualState, sentryMode: e.target.checked })
          }
          className="accent-[#e31937]"
        />
        {t('showroom.sentryPreview', 'Afficher les sentinelles (aperçu)')}
      </label>

      {positions.length === 0 ? (
        <p className="text-[10px] text-[#6b7280]">
          {t(
            'showroom.sentryEmpty',
            'Aucune caméra placée. Ajoute une caméra puis positionne-la sur la carrosserie.',
          )}
        </p>
      ) : (
        <div className="space-y-3">
          {positions.map((p, idx) => (
            <div
              key={idx}
              className="space-y-1.5 border-l border-[#2a2a2a] pl-2"
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wider text-[#6b7280]">
                  {t('showroom.sentryCamera', 'Caméra')} {idx + 1}
                </span>
                <button
                  type="button"
                  onClick={() => removeOne(idx)}
                  className="text-[10px] text-[#6b7280] hover:text-[#ef4444]"
                  title={t('showroom.remove', 'Supprimer')}
                >
                  ✕
                </button>
              </div>
              <ShowroomVec3Slider
                label=""
                value={p}
                onChange={(v) => updateOne(idx, v)}
                min={-3}
                max={3}
                step={0.01}
                unit="m"
              />
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={addOne}
        className={
          'w-full h-8 text-xs rounded-md bg-[#1a1a1a] border border-[#2a2a2a] ' +
          'text-[#9ca3af] hover:text-white hover:bg-[#2a2a2a] transition-colors'
        }
      >
        + {t('showroom.sentryAdd', 'Ajouter une caméra')}
      </button>

      <p className="text-[10px] text-[#6b7280]">
        {t(
          'showroom.sentryHint',
          'Positions en mètres relatives à la carrosserie (X avant, Y haut, Z droite).',
        )}
      </p>
    </section>
  );
}
