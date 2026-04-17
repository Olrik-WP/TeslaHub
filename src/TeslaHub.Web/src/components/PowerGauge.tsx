import { useTranslation } from 'react-i18next';

interface Props {
  power: number;
  maxPower?: number;
  accentColor?: string;
}

export default function PowerGauge({ power, maxPower = 300, accentColor = '#e31937' }: Props) {
  const { t } = useTranslation();
  const clamped = Math.max(-maxPower, Math.min(power, maxPower));
  const fraction = clamped / maxPower;
  const isRegen = clamped < 0;

  const barWidth = 320;
  const barHeight = 18;
  const centerX = barWidth / 2;
  const fillWidth = Math.abs(fraction) * (barWidth / 2);

  const regenColor = '#22c55e';
  const consumeColor = accentColor;

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-1 px-1">
        <span className="text-[10px] text-[#22c55e] uppercase tracking-wider">{t('dashboard.regen')}</span>
        <span className="text-sm font-bold tabular-nums" style={{ color: isRegen ? regenColor : consumeColor }}>
          {clamped > 0 ? '+' : ''}{clamped} <span className="text-xs font-normal text-[#9ca3af]">kW</span>
        </span>
        <span className="text-[10px] uppercase tracking-wider" style={{ color: consumeColor }}>{t('dashboard.consumption')}</span>
      </div>
      <svg viewBox={`0 0 ${barWidth} ${barHeight + 10}`} className="w-full" preserveAspectRatio="xMidYMid meet">
        {/* Background bar */}
        <rect
          x={0} y={5}
          width={barWidth} height={barHeight}
          rx={barHeight / 2}
          fill="#1a1a1a"
        />

        {/* Center line */}
        <line
          x1={centerX} y1={2}
          x2={centerX} y2={barHeight + 8}
          stroke="#4b5563"
          strokeWidth={1.5}
        />

        {/* Active fill */}
        {Math.abs(clamped) > 0 && (
          <rect
            x={isRegen ? centerX - fillWidth : centerX}
            y={5}
            width={fillWidth}
            height={barHeight}
            rx={2}
            fill={isRegen ? regenColor : consumeColor}
            className="transition-all duration-200 ease-out"
            style={{ filter: `drop-shadow(0 0 8px ${isRegen ? regenColor : consumeColor}40)` }}
          />
        )}

        {/* Scale marks */}
        {[-1, -0.5, 0, 0.5, 1].map((pct) => {
          const xPos = centerX + pct * (barWidth / 2);
          return (
            <line
              key={pct}
              x1={xPos} y1={0}
              x2={xPos} y2={3}
              stroke="#4b5563"
              strokeWidth={1}
            />
          );
        })}
      </svg>
    </div>
  );
}
