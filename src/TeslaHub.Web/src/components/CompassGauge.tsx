import { useTranslation } from 'react-i18next';

interface Props {
  heading: number;
  elevation?: number | null;
  accentColor?: string;
}

const CX = 100;
const CY = 100;
const R = 80;

function polarToXY(angle: number, r: number) {
  const rad = ((angle - 90) * Math.PI) / 180;
  return { x: CX + r * Math.cos(rad), y: CY + r * Math.sin(rad) };
}

const CARDINAL = [
  { label: 'N', angle: 0, color: '#ef4444' },
  { label: 'E', angle: 90, color: '#9ca3af' },
  { label: 'S', angle: 180, color: '#9ca3af' },
  { label: 'W', angle: 270, color: '#9ca3af' },
];

const INTERCARDINAL = [
  { angle: 45 }, { angle: 135 }, { angle: 225 }, { angle: 315 },
];

function headingToCardinal(h: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(h / 45) % 8];
}

export default function CompassGauge({ heading, elevation, accentColor = '#e31937' }: Props) {
  const { t } = useTranslation();
  const rotation = -heading;

  return (
    <div className="flex flex-col items-center gap-1">
      <svg viewBox="0 0 200 200" className="w-full max-w-[180px]">
        {/* Outer ring */}
        <circle cx={CX} cy={CY} r={R + 8} fill="none" stroke="#2a2a2a" strokeWidth={1} />
        <circle cx={CX} cy={CY} r={R} fill="#0a0a0a" stroke="#2a2a2a" strokeWidth={2} />

        {/* Rotating group */}
        <g
          transform={`rotate(${rotation} ${CX} ${CY})`}
          className="transition-transform duration-300 ease-out"
        >
          {/* Minor tick marks every 15 degrees */}
          {Array.from({ length: 24 }).map((_, i) => {
            const angle = i * 15;
            const outer = polarToXY(angle, R - 2);
            const inner = polarToXY(angle, R - 8);
            return (
              <line
                key={i}
                x1={outer.x} y1={outer.y}
                x2={inner.x} y2={inner.y}
                stroke="#3a3a3a"
                strokeWidth={1}
              />
            );
          })}

          {/* Intercardinal ticks */}
          {INTERCARDINAL.map((ic) => {
            const outer = polarToXY(ic.angle, R - 2);
            const inner = polarToXY(ic.angle, R - 14);
            return (
              <line
                key={ic.angle}
                x1={outer.x} y1={outer.y}
                x2={inner.x} y2={inner.y}
                stroke="#4b5563"
                strokeWidth={1.5}
              />
            );
          })}

          {/* Cardinal labels */}
          {CARDINAL.map((c) => {
            const outer = polarToXY(c.angle, R - 2);
            const inner = polarToXY(c.angle, R - 16);
            const labelPos = polarToXY(c.angle, R - 30);
            return (
              <g key={c.label}>
                <line
                  x1={outer.x} y1={outer.y}
                  x2={inner.x} y2={inner.y}
                  stroke={c.color}
                  strokeWidth={2}
                />
                <text
                  x={labelPos.x}
                  y={labelPos.y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill={c.color}
                  fontSize={14}
                  fontWeight={700}
                >
                  {c.label}
                </text>
              </g>
            );
          })}
        </g>

        {/* Fixed needle pointing UP */}
        <polygon
          points={`${CX},${CY - R + 20} ${CX - 6},${CY - R + 38} ${CX + 6},${CY - R + 38}`}
          fill={accentColor}
          style={{ filter: `drop-shadow(0 0 4px ${accentColor}80)` }}
        />

        {/* Center dot */}
        <circle cx={CX} cy={CY} r={6} fill={accentColor} />
        <circle cx={CX} cy={CY} r={3} fill="#0a0a0a" />

        {/* Heading text */}
        <text
          x={CX}
          y={CY + 22}
          textAnchor="middle"
          fill="white"
          fontSize={18}
          fontWeight="bold"
          fontFamily="ui-monospace, monospace"
        >
          {Math.round(heading)}°
        </text>
        <text
          x={CX}
          y={CY + 38}
          textAnchor="middle"
          fill="#9ca3af"
          fontSize={11}
        >
          {headingToCardinal(heading)}
        </text>
      </svg>

      {elevation != null && (
        <div className="text-center">
          <span className="text-xs text-[#9ca3af]">{t('dashboard.elevation')}: </span>
          <span className="text-sm font-bold tabular-nums text-white">{elevation} m</span>
        </div>
      )}
    </div>
  );
}
