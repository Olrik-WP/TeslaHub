import { useTranslation } from 'react-i18next';

interface Props {
  speed: number;
  maxSpeed: number;
  unit: string;
  shiftState?: string | null;
  accentColor?: string;
}

const CX = 200;
const CY = 200;
const R = 160;
const STROKE = 10;
const START_ANGLE = 135;
const END_ANGLE = 405;
const SWEEP = END_ANGLE - START_ANGLE;

function polarToXY(angle: number, r: number) {
  const rad = (angle * Math.PI) / 180;
  return { x: CX + r * Math.cos(rad), y: CY + r * Math.sin(rad) };
}

const SHIFT_COLORS: Record<string, string> = {
  D: '#22c55e',
  R: '#ef4444',
  N: '#eab308',
  P: '#3b82f6',
};

export default function SpeedGaugeDigital({ speed, maxSpeed, unit, shiftState, accentColor = '#e31937' }: Props) {
  const { t } = useTranslation();
  const clampedSpeed = Math.max(0, Math.min(speed, maxSpeed));
  const fraction = clampedSpeed / maxSpeed;

  const circumference = 2 * Math.PI * R;
  const arcLength = (SWEEP / 360) * circumference;
  const progressLength = arcLength * fraction;
  const gapLength = arcLength - progressLength;

  const segmentCount = 40;
  const segmentArc = arcLength / segmentCount;
  const segmentGap = segmentArc * 0.15;
  const segmentFill = segmentArc - segmentGap;

  const activeSegments = Math.round(segmentCount * fraction);

  const digits = Math.round(clampedSpeed).toString().padStart(3, ' ');

  return (
    <div className="flex items-center justify-center w-full">
      <svg viewBox="0 0 400 400" className="w-full max-w-[400px]">
        {/* Background ring segments */}
        {Array.from({ length: segmentCount }).map((_, i) => {
          const segStart = START_ANGLE + (i / segmentCount) * SWEEP;
          const segEnd = segStart + (SWEEP / segmentCount) * 0.8;
          const p1 = polarToXY(segStart, R);
          const p2 = polarToXY(segEnd, R);
          const isActive = i < activeSegments;

          let segColor = '#1a1a1a';
          if (isActive) {
            const pct = i / segmentCount;
            if (pct < 0.5) segColor = accentColor + '90';
            else if (pct < 0.75) segColor = accentColor + 'c0';
            else segColor = accentColor;
          }

          return (
            <path
              key={i}
              d={`M ${p1.x} ${p1.y} A ${R} ${R} 0 0 1 ${p2.x} ${p2.y}`}
              fill="none"
              stroke={segColor}
              strokeWidth={STROKE}
              strokeLinecap="round"
              className="transition-all duration-150 ease-out"
            />
          );
        })}

        {/* Outer glow ring */}
        {clampedSpeed > 0 && (
          <circle
            cx={CX}
            cy={CY}
            r={R + 18}
            fill="none"
            stroke={accentColor}
            strokeWidth={1}
            opacity={0.15 + fraction * 0.25}
          />
        )}

        {/* Digital speed display */}
        <text
          x={CX}
          y={CY + 10}
          textAnchor="middle"
          fill="white"
          fontSize={80}
          fontWeight="bold"
          fontFamily="ui-monospace, 'Courier New', monospace"
          letterSpacing={8}
          style={{ filter: `drop-shadow(0 0 20px ${accentColor}40)` }}
        >
          {Math.round(clampedSpeed)}
        </text>

        {/* Unit label */}
        <text
          x={CX}
          y={CY + 42}
          textAnchor="middle"
          fill="#6b7280"
          fontSize={16}
          fontWeight={500}
          letterSpacing={4}
          textTransform="uppercase"
        >
          {unit}
        </text>

        {/* Shift state badges */}
        {shiftState && (
          <>
            {['P', 'R', 'N', 'D'].map((s, i) => {
              const isActive = shiftState === s;
              const xPos = CX - 54 + i * 36;
              const yPos = CY + 70;
              return (
                <g key={s}>
                  <rect
                    x={xPos - 14}
                    y={yPos - 12}
                    width={28}
                    height={24}
                    rx={4}
                    fill={isActive ? (SHIFT_COLORS[s] ?? '#9ca3af') : '#1a1a1a'}
                    stroke={isActive ? 'none' : '#2a2a2a'}
                    strokeWidth={1}
                    opacity={isActive ? 1 : 0.5}
                  />
                  <text
                    x={xPos}
                    y={yPos + 1}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill={isActive ? '#0a0a0a' : '#4b5563'}
                    fontSize={14}
                    fontWeight={isActive ? 700 : 400}
                  >
                    {s}
                  </text>
                </g>
              );
            })}
          </>
        )}

        {/* Scale markers at 0, 25%, 50%, 75%, 100% */}
        {[0, 0.25, 0.5, 0.75, 1].map((pct) => {
          const angle = START_ANGLE + pct * SWEEP;
          const outer = polarToXY(angle, R + 18);
          const inner = polarToXY(angle, R + 12);
          const labelPos = polarToXY(angle, R + 30);
          const val = Math.round(pct * maxSpeed);
          return (
            <g key={pct}>
              <line
                x1={outer.x} y1={outer.y}
                x2={inner.x} y2={inner.y}
                stroke="#4b5563"
                strokeWidth={1.5}
              />
              <text
                x={labelPos.x}
                y={labelPos.y}
                textAnchor="middle"
                dominantBaseline="central"
                fill="#4b5563"
                fontSize={10}
              >
                {val}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
