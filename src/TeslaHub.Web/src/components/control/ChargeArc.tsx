import type { ReactNode } from 'react';

/**
 * Battery state-of-charge arc, used as the hero element of ChargeCard.
 *
 * Visual: a thick 280° arc (same geometry as TempDial so the two
 * heroes line up vertically on the Control page). The active portion
 * uses a green→amber→red gradient running CCW so that "high battery"
 * lights up the full green ring and "low battery" stays in the red
 * region, matching the universal battery-color intuition.
 *
 * Read-only: there is no thumb, no buttons. The card below the arc
 * holds the actual charge limit / start-stop / port controls. The arc
 * exists purely to surface the at-a-glance battery percentage in a
 * Tesla-app-style hero block.
 *
 * Optional `limit` overlay: when provided, a thin tick mark on the
 * track shows where the user's charge limit sits (e.g. 81%). Helps
 * the user see "I'm at 55% out of my 81% target" without reading the
 * slider below.
 */
interface Props {
  /** Current state-of-charge in percent (0–100). */
  percent: number;
  /** Optional charge limit overlay (0–100). Renders a small tick. */
  limit?: number | null;
  /** Big text in the centre (e.g. "55"). */
  centerValue: ReactNode;
  /** Small caption under the centre value (e.g. "%"). */
  centerSuffix?: ReactNode;
  /** Tiny line below the suffix (e.g. "253 km"). */
  subline?: ReactNode;
  /** Override the active arc colour (e.g. amber when stopped). */
  accent?: 'auto' | 'charging' | 'plugged' | 'idle';
}

// Same geometry as TempDial — see that file for the rationale on the
// 280° centred-on-top arc.
const SIZE = 220;
const STROKE = 14;
const RADIUS = (SIZE - STROKE) / 2;
const CX = SIZE / 2;
const CY = SIZE / 2;
const ARC_START_ANGLE = 220;
const ARC_END_ANGLE = 140;
const ARC_TOTAL_DEG = 280;

function polarToCart(angleDeg: number, r: number = RADIUS) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: CX + r * Math.cos(rad), y: CY + r * Math.sin(rad) };
}

function arcPath(startAngle: number, endAngle: number): string {
  const start = polarToCart(startAngle);
  const end = polarToCart(endAngle);
  const sweepDeg = (endAngle - startAngle + 360) % 360;
  const largeArc = sweepDeg > 180 ? 1 : 0;
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${RADIUS} ${RADIUS} 0 ${largeArc} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
}

function percentToAngle(pct: number): number {
  const ratio = Math.max(0, Math.min(1, pct / 100));
  return (ARC_START_ANGLE + ratio * ARC_TOTAL_DEG) % 360;
}

/**
 * Picks the gradient ID for the active arc based on charge state.
 *   - charging: solid green (energy flowing in)
 *   - plugged + idle: blue (connected, not active)
 *   - idle (unplugged): tri-stop red→amber→green so the arc reads as
 *     a fuel gauge — low % is red, high % is green.
 */
function pickGradientId(accent: NonNullable<Props['accent']>): string {
  switch (accent) {
    case 'charging':
      return 'charge-arc-green';
    case 'plugged':
      return 'charge-arc-blue';
    case 'idle':
    case 'auto':
    default:
      return 'charge-arc-fuel';
  }
}

export default function ChargeArc({
  percent,
  limit,
  centerValue,
  centerSuffix,
  subline,
  accent = 'auto',
}: Props) {
  const clamped = Math.max(0, Math.min(100, percent));
  const activeAngle = percentToAngle(clamped);
  const activePath =
    clamped <= 0
      ? null
      : clamped >= 100
        ? arcPath(ARC_START_ANGLE, ARC_END_ANGLE)
        : arcPath(ARC_START_ANGLE, activeAngle);

  const limitAngle =
    limit != null && limit > 0 && limit < 100 ? percentToAngle(limit) : null;
  const limitTick = limitAngle != null ? polarToCart(limitAngle) : null;
  // Inner / outer end of the limit tick (a short radial segment) so it
  // looks like a notch ON the track rather than a stray dot near it.
  const limitInner = limitAngle != null ? polarToCart(limitAngle, RADIUS - STROKE / 2 - 2) : null;
  const limitOuter = limitAngle != null ? polarToCart(limitAngle, RADIUS + STROKE / 2 + 2) : null;

  const gradId = pickGradientId(accent);

  return (
    <div className="flex items-center justify-center my-2">
      <div className="relative" style={{ width: SIZE, height: SIZE }}>
        <svg
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          width={SIZE}
          height={SIZE}
          aria-hidden="true"
        >
          <defs>
            <linearGradient id="charge-arc-fuel" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#ef4444" />
              <stop offset="50%" stopColor="#f59e0b" />
              <stop offset="100%" stopColor="#22c55e" />
            </linearGradient>
            <linearGradient id="charge-arc-green" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#16a34a" />
              <stop offset="100%" stopColor="#4ade80" />
            </linearGradient>
            <linearGradient id="charge-arc-blue" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#2563eb" />
              <stop offset="100%" stopColor="#60a5fa" />
            </linearGradient>
          </defs>

          {/* Subdued track */}
          <path
            d={arcPath(ARC_START_ANGLE, ARC_END_ANGLE)}
            fill="none"
            stroke="#1f1f1f"
            strokeWidth={STROKE}
            strokeLinecap="round"
          />

          {/* Active portion */}
          {activePath && (
            <path
              d={activePath}
              fill="none"
              stroke={`url(#${gradId})`}
              strokeWidth={STROKE}
              strokeLinecap="round"
            />
          )}

          {/* Charge-limit notch */}
          {limitTick && limitInner && limitOuter && (
            <line
              x1={limitInner.x}
              y1={limitInner.y}
              x2={limitOuter.x}
              y2={limitOuter.y}
              stroke="#e0e0e0"
              strokeWidth={2}
              strokeLinecap="round"
              opacity={0.75}
            />
          )}
        </svg>

        {/* Center label */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <div className="flex items-baseline">
            <span className="text-5xl font-semibold text-[#e0e0e0] tabular-nums">
              {centerValue}
            </span>
            {centerSuffix && (
              <span className="text-xl text-[#9ca3af] ml-0.5">{centerSuffix}</span>
            )}
          </div>
          {subline && (
            <span className="text-xs text-[#9ca3af] mt-1 tabular-nums">{subline}</span>
          )}
        </div>
      </div>
    </div>
  );
}
