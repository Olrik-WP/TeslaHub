import type { ReactNode } from 'react';

/**
 * Circular temperature dial used as the hero element of ClimateCard.
 *
 * Visual: a thick 280° arc spanning the top portion of a circle with a
 * cold-to-warm linear gradient. The portion of the arc up to the
 * current value is rendered "active" (gradient), the rest stays
 * subdued. A small thumb sits at the active end. The big value is
 * displayed in the dial's center.
 *
 * Interaction:
 *   - `+` / `-` buttons next to the dial step the value.
 *   - The dial itself is currently NON-interactive (no drag) — the
 *     buttons drive every change. Drag could be added later without
 *     touching the API of this component.
 *
 * Display unit is decoupled from the canonical unit:
 *   - `value` / `min` / `max` are in the *display* unit (already
 *     converted by the caller); this component does NOT convert.
 *   - `formatValue(value)` controls how the value is printed at the
 *     center (the caller decides between "22.0°C" / "72°F" / "—").
 *
 * Conventions:
 *   - `disabled` greys out the dial and disables the stepper buttons.
 *     The dial still draws the current value — useful when the car
 *     is asleep and the temperature is read-only.
 */
interface Props {
  /** Current value in the *display* unit (already converted). */
  value: number;
  /** Lower bound in the *display* unit. */
  min: number;
  /** Upper bound in the *display* unit. */
  max: number;
  /** Increment in the *display* unit per `+` / `-` tap. */
  step: number;
  /** Renders the value at the centre of the dial (e.g. "22.0°C"). */
  formatValue: (value: number) => string;
  /** Tiny caption under the value (e.g. "Driver"). Optional. */
  centerCaption?: ReactNode;
  onDecrement: () => void;
  onIncrement: () => void;
  disabled?: boolean;
  /** Disable just the `+` button (e.g. command in flight). */
  busy?: boolean;
}

// ─── Arc geometry ───────────────────────────────────────────────────────
// 0° = top (12 o'clock), increasing clockwise.
// The dial spans 280° centred on the top, so it leaves a 80° gap at
// the bottom (40° on each side). That's the Tesla-app convention.
const SIZE = 220;
const STROKE = 14;
const RADIUS = (SIZE - STROKE) / 2;
const CX = SIZE / 2;
const CY = SIZE / 2;
const ARC_START_ANGLE = 220; // bottom-left
const ARC_END_ANGLE = 140;   // bottom-right (going clockwise through top → 360 - 80 = 280° of arc)
const ARC_TOTAL_DEG = 280;

function polarToCart(angleDeg: number, r: number = RADIUS) {
  // -90 so that 0° points to the top (12 o'clock) instead of the right.
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: CX + r * Math.cos(rad), y: CY + r * Math.sin(rad) };
}

/**
 * SVG path for an arc from `startAngle` clockwise to `endAngle`.
 * Both angles in degrees, 0° = top, increasing clockwise.
 *
 * The hand-written sweep/large-arc flags are picked so the arc draws
 * the "outside" of the implicit chord — i.e. when start = 220° and
 * end = 140° the path takes the long route through the top (280°),
 * not the short route through the bottom (80°).
 */
function arcPath(startAngle: number, endAngle: number): string {
  const start = polarToCart(startAngle);
  const end = polarToCart(endAngle);
  // Clockwise sweep that goes "the long way" — through the top.
  const sweepDeg = (endAngle - startAngle + 360) % 360;
  const largeArc = sweepDeg > 180 ? 1 : 0;
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${RADIUS} ${RADIUS} 0 ${largeArc} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
}

/**
 * Maps a value in [min, max] to the corresponding angle on the dial.
 * The arc starts at `ARC_START_ANGLE` and progresses CLOCKWISE through
 * the top until `ARC_END_ANGLE`, so the angle for a given value is
 * `start + ratio * 280°` modulo 360°.
 */
function valueToAngle(value: number, min: number, max: number): number {
  if (max <= min) return ARC_START_ANGLE;
  const ratio = Math.max(0, Math.min(1, (value - min) / (max - min)));
  return (ARC_START_ANGLE + ratio * ARC_TOTAL_DEG) % 360;
}

export default function TempDial({
  value,
  min,
  max,
  step,
  formatValue,
  centerCaption,
  onDecrement,
  onIncrement,
  disabled = false,
  busy = false,
}: Props) {
  const clamped = Math.max(min, Math.min(max, value));
  const thumbAngle = valueToAngle(clamped, min, max);
  const thumbPos = polarToCart(thumbAngle);

  // The "active" arc draws from start up to the thumb. When value is at
  // min the active arc length is 0; at max it spans the full 280°.
  const activePath =
    clamped <= min
      ? null
      : clamped >= max
        ? arcPath(ARC_START_ANGLE, ARC_END_ANGLE)
        : arcPath(ARC_START_ANGLE, thumbAngle);

  const buttonsDisabled = disabled || busy;
  const decDisabled = buttonsDisabled || clamped <= min + 0.0001;
  const incDisabled = buttonsDisabled || clamped >= max - 0.0001;

  return (
    <div className="flex items-center justify-between gap-2 my-2 select-none">
      <button
        type="button"
        onClick={onDecrement}
        disabled={decDisabled}
        aria-label={`-${step}`}
        className="w-12 h-12 rounded-full bg-[#1a1a1a] border border-[#2a2a2a] text-[#e0e0e0] text-2xl leading-none flex items-center justify-center active:bg-[#222] disabled:opacity-40 transition-colors"
      >
        −
      </button>

      <div className="relative flex-shrink-0" style={{ width: SIZE, height: SIZE }}>
        <svg
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          width={SIZE}
          height={SIZE}
          className={disabled ? 'opacity-50' : ''}
          aria-hidden="true"
        >
          <defs>
            {/* Linear cold→warm gradient. We map x from left (cold blue)
                to right (warm red) so the arc tints horizontally — same
                visual idiom as the Tesla mobile app. */}
            <linearGradient id="temp-dial-grad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#3b82f6" />
              <stop offset="35%" stopColor="#a855f7" />
              <stop offset="65%" stopColor="#ec4899" />
              <stop offset="100%" stopColor="#ef4444" />
            </linearGradient>
          </defs>

          {/* Subdued track — drawn first so the active arc overlays it. */}
          <path
            d={arcPath(ARC_START_ANGLE, ARC_END_ANGLE)}
            fill="none"
            stroke="#1f1f1f"
            strokeWidth={STROKE}
            strokeLinecap="round"
          />

          {/* Active portion (gradient). Hidden entirely when value=min. */}
          {activePath && (
            <path
              d={activePath}
              fill="none"
              stroke="url(#temp-dial-grad)"
              strokeWidth={STROKE}
              strokeLinecap="round"
            />
          )}

          {/* Thumb — white pellet at the active end. The outer ring is a
              slight glow so the thumb stays visible against the gradient. */}
          <circle
            cx={thumbPos.x}
            cy={thumbPos.y}
            r={STROKE / 2 + 4}
            fill="#0a0a0a"
            stroke="#ffffff"
            strokeWidth={2}
          />
        </svg>

        {/* Center label — absolutely centred over the SVG so it works
            regardless of viewport scaling. */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-4xl font-semibold text-[#e0e0e0] tabular-nums">
            {formatValue(clamped)}
          </span>
          {centerCaption && (
            <span className="text-[11px] uppercase tracking-wide text-[#6b7280] mt-0.5">
              {centerCaption}
            </span>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={onIncrement}
        disabled={incDisabled}
        aria-label={`+${step}`}
        className="w-12 h-12 rounded-full bg-[#1a1a1a] border border-[#2a2a2a] text-[#e0e0e0] text-2xl leading-none flex items-center justify-center active:bg-[#222] disabled:opacity-40 transition-colors"
      >
        +
      </button>
    </div>
  );
}
