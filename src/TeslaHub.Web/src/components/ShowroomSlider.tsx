/**
 * Small numeric slider widget for the Showroom right-panel sections.
 *
 * UX choices:
 *   - The slider track is wide (better touch target on tablets) and
 *     pairs with a tiny numeric input on the right so the user can
 *     type an exact value when sliding isn't precise enough.
 *   - When `defaultValue` is provided and the current value differs,
 *     a "Reset" button appears next to the label. Click → resets the
 *     value back to the default (the per-field equivalent of "Auto"
 *     in the Model section).
 *   - `step` defaults to 0.001 — fine enough for sub-cm geometry
 *     calibration but the displayed value rounds to 3 decimals to
 *     avoid 0.300000001 noise.
 *
 * The component is fully controlled — parent owns the value and the
 * onChange handler decides what to do with it (typically: write into
 * a partial override blob and pass it to the viewer).
 */
import { useId } from 'react';

interface Props {
  /** Short caption shown above the slider (e.g. "X", "Position Y"). */
  label: string;
  /** Current value. */
  value: number;
  /** Called every time the slider moves OR the number input commits. */
  onChange: (next: number) => void;
  /** When provided, a small "↺" button shows next to the label when the
   *  value differs, and resets back to this default on click. Typically
   *  the matching field on `VehicleModelConfig` so users can revert any
   *  individual tweak without losing the others. */
  defaultValue?: number;
  /** Slider range. Defaults: [-3, +3] which covers every body-relative
   *  coordinate on a Model 3 / Y. Override for special cases (FOV
   *  10..120, opacity 0..1, etc.). */
  min?: number;
  max?: number;
  step?: number;
  /** Optional units suffix shown after the numeric input
   *  (e.g. "m", "°", "x"). Purely cosmetic. */
  unit?: string;
  /** When true the value is shown in red — used to flag a value out of
   *  the typical "safe" range so the user knows they're way off. */
  warn?: boolean;
}

const fmt = (n: number, step: number): string => {
  // Round to whichever precision the step implies, max 4 decimals.
  // step=1 → 0 decimals, step=0.1 → 1, step=0.01 → 2, step=0.001 → 3.
  if (step >= 1) return Math.round(n).toString();
  if (step >= 0.1) return n.toFixed(1);
  if (step >= 0.01) return n.toFixed(2);
  return n.toFixed(3);
};

export function ShowroomSlider({
  label,
  value,
  onChange,
  defaultValue,
  min = -3,
  max = 3,
  step = 0.001,
  unit,
  warn,
}: Props) {
  const id = useId();
  const showReset =
    defaultValue !== undefined &&
    Math.abs(value - defaultValue) > step / 2;

  return (
    <div className="flex items-center gap-2">
      <div className="w-9 shrink-0">
        <label
          htmlFor={id}
          className="text-[10px] uppercase tracking-wider text-[#9ca3af] font-mono"
        >
          {label}
        </label>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="flex-1 h-1.5 accent-[#e31937] cursor-pointer"
      />
      <div className="flex items-center gap-0.5">
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={fmt(value, step)}
          onChange={(e) => {
            const n = parseFloat(e.target.value);
            if (Number.isFinite(n)) onChange(n);
          }}
          className={
            'w-14 h-6 bg-[#0a0a0a] border border-[#2a2a2a] rounded px-1.5 ' +
            'text-[11px] text-right font-mono focus:border-[#e31937] focus:outline-none ' +
            (warn ? 'text-amber-400' : 'text-white')
          }
        />
        {unit && (
          <span className="text-[10px] text-[#6b7280] font-mono w-3 text-left">
            {unit}
          </span>
        )}
        {showReset ? (
          <button
            type="button"
            onClick={() => defaultValue !== undefined && onChange(defaultValue)}
            title={`Réinitialiser à ${fmt(defaultValue ?? 0, step)}${unit ?? ''}`}
            className="w-5 h-5 flex items-center justify-center text-[10px] rounded text-[#6b7280] hover:text-white hover:bg-[#2a2a2a]"
          >
            ↺
          </button>
        ) : (
          <span className="w-5" />
        )}
      </div>
    </div>
  );
}

/** Pre-baked group for a 3D vector (XYZ on three lines). Avoids the
 *  caller having to repeat the same Slider three times for each
 *  position / target / direction field. */
interface Vec3SliderProps {
  label: string;
  value: readonly [number, number, number];
  onChange: (next: [number, number, number]) => void;
  defaultValue?: readonly [number, number, number];
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
}

export function ShowroomVec3Slider({
  label,
  value,
  onChange,
  defaultValue,
  min,
  max,
  step,
  unit,
}: Vec3SliderProps) {
  return (
    <div className="space-y-1.5">
      {label !== '' && (
        <p className="text-[10px] uppercase tracking-wider text-[#6b7280]">
          {label}
        </p>
      )}
      <ShowroomSlider
        label="X"
        value={value[0]}
        onChange={(n) => onChange([n, value[1], value[2]])}
        defaultValue={defaultValue?.[0]}
        min={min}
        max={max}
        step={step}
        unit={unit}
      />
      <ShowroomSlider
        label="Y"
        value={value[1]}
        onChange={(n) => onChange([value[0], n, value[2]])}
        defaultValue={defaultValue?.[1]}
        min={min}
        max={max}
        step={step}
        unit={unit}
      />
      <ShowroomSlider
        label="Z"
        value={value[2]}
        onChange={(n) => onChange([value[0], value[1], n])}
        defaultValue={defaultValue?.[2]}
        min={min}
        max={max}
        step={step}
        unit={unit}
      />
    </div>
  );
}
