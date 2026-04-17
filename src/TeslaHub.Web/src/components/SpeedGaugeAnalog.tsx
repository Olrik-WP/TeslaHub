import { useTranslation } from 'react-i18next';

export interface GaugeColorZone {
  from: number;
  to: number;
  color: string;
}

interface Props {
  speed: number;
  maxSpeed: number;
  unit: string;
  shiftState?: string | null;
  colorZones?: GaugeColorZone[];
  accentColor?: string;
}

const DEFAULT_ZONES: GaugeColorZone[] = [
  { from: 0, to: 80, color: '#22c55e' },
  { from: 80, to: 120, color: '#eab308' },
  { from: 120, to: 300, color: '#ef4444' },
];

const CX = 200;
const CY = 200;
const R = 160;
const STROKE = 14;
const START_ANGLE = 135;
const END_ANGLE = 405;
const SWEEP = END_ANGLE - START_ANGLE;

function polarToXY(angle: number, r: number) {
  const rad = (angle * Math.PI) / 180;
  return { x: CX + r * Math.cos(rad), y: CY + r * Math.sin(rad) };
}

function valueToAngle(value: number, max: number) {
  return START_ANGLE + (Math.min(value, max) / max) * SWEEP;
}

function describeArc(startAngle: number, endAngle: number, radius: number) {
  const start = polarToXY(startAngle, radius);
  const end = polarToXY(endAngle, radius);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} 1 ${end.x} ${end.y}`;
}

const SHIFT_COLORS: Record<string, string> = {
  D: '#22c55e',
  R: '#ef4444',
  N: '#eab308',
  P: '#3b82f6',
};

export default function SpeedGaugeAnalog({ speed, maxSpeed, unit, shiftState, colorZones, accentColor = '#e31937' }: Props) {
  const { t } = useTranslation();
  const zones = colorZones ?? DEFAULT_ZONES;
  const clampedSpeed = Math.max(0, Math.min(speed, maxSpeed));
  const needleAngle = valueToAngle(clampedSpeed, maxSpeed);

  const majorStep = maxSpeed <= 160 ? 20 : maxSpeed <= 200 ? 20 : 40;
  const minorStep = majorStep / 2;
  const majorTicks: number[] = [];
  for (let v = 0; v <= maxSpeed; v += majorStep) majorTicks.push(v);
  const minorTicks: number[] = [];
  for (let v = 0; v <= maxSpeed; v += minorStep) {
    if (!majorTicks.includes(v)) minorTicks.push(v);
  }

  const needleTip = polarToXY(needleAngle, R - 20);
  const needleBase1 = polarToXY(needleAngle + 90, 6);
  const needleBase2 = polarToXY(needleAngle - 90, 6);

  return (
    <div className="flex items-center justify-center w-full">
      <svg viewBox="0 0 400 400" className="w-full max-w-[400px]">
        {/* Background arc */}
        <path
          d={describeArc(START_ANGLE, END_ANGLE, R)}
          fill="none"
          stroke="#2a2a2a"
          strokeWidth={STROKE}
          strokeLinecap="round"
        />

        {/* Color zone arcs */}
        {zones.map((zone, i) => {
          const zStart = Math.max(zone.from, 0);
          const zEnd = Math.min(zone.to, maxSpeed);
          if (zStart >= maxSpeed || zEnd <= 0) return null;
          const a1 = valueToAngle(zStart, maxSpeed);
          const a2 = valueToAngle(zEnd, maxSpeed);
          return (
            <path
              key={i}
              d={describeArc(a1, a2, R)}
              fill="none"
              stroke={zone.color}
              strokeWidth={STROKE}
              strokeLinecap="butt"
              opacity={0.25}
            />
          );
        })}

        {/* Progress arc */}
        {clampedSpeed > 0 && (
          <path
            d={describeArc(START_ANGLE, needleAngle, R)}
            fill="none"
            stroke={accentColor}
            strokeWidth={STROKE}
            strokeLinecap="round"
            className="transition-all duration-300 ease-out"
          />
        )}

        {/* Major ticks + labels */}
        {majorTicks.map((v) => {
          const angle = valueToAngle(v, maxSpeed);
          const outer = polarToXY(angle, R + 10);
          const inner = polarToXY(angle, R - 22);
          const labelPos = polarToXY(angle, R - 40);
          return (
            <g key={`major-${v}`}>
              <line
                x1={outer.x} y1={outer.y}
                x2={inner.x} y2={inner.y}
                stroke="#9ca3af"
                strokeWidth={2}
              />
              <text
                x={labelPos.x}
                y={labelPos.y}
                textAnchor="middle"
                dominantBaseline="central"
                fill="#9ca3af"
                fontSize={14}
                fontWeight={600}
              >
                {v}
              </text>
            </g>
          );
        })}

        {/* Minor ticks */}
        {minorTicks.map((v) => {
          const angle = valueToAngle(v, maxSpeed);
          const outer = polarToXY(angle, R + 6);
          const inner = polarToXY(angle, R - 16);
          return (
            <line
              key={`minor-${v}`}
              x1={outer.x} y1={outer.y}
              x2={inner.x} y2={inner.y}
              stroke="#4b5563"
              strokeWidth={1}
            />
          );
        })}

        {/* Needle */}
        <polygon
          points={`${needleTip.x},${needleTip.y} ${needleBase1.x},${needleBase1.y} ${needleBase2.x},${needleBase2.y}`}
          fill={accentColor}
          className="transition-all duration-300 ease-out"
          style={{ filter: `drop-shadow(0 0 6px ${accentColor}80)` }}
        />
        <circle cx={CX} cy={CY} r={10} fill={accentColor} />
        <circle cx={CX} cy={CY} r={5} fill="#0a0a0a" />

        {/* Speed value */}
        <text
          x={CX}
          y={CY + 50}
          textAnchor="middle"
          fill="white"
          fontSize={56}
          fontWeight="bold"
          fontFamily="ui-monospace, monospace"
        >
          {Math.round(clampedSpeed)}
        </text>

        {/* Unit */}
        <text
          x={CX}
          y={CY + 78}
          textAnchor="middle"
          fill="#9ca3af"
          fontSize={16}
        >
          {unit}
        </text>

        {/* Shift state */}
        {shiftState && (
          <text
            x={CX}
            y={CY + 105}
            textAnchor="middle"
            fill={SHIFT_COLORS[shiftState] ?? '#9ca3af'}
            fontSize={28}
            fontWeight="bold"
          >
            {shiftState}
          </text>
        )}
      </svg>
    </div>
  );
}
