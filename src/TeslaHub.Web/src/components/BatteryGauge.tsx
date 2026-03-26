import { useTranslation } from 'react-i18next';

interface Props {
  level: number;
  rangeKm?: number | null;
  rangeUnit?: string;
  isCharging?: boolean;
}

export default function BatteryGauge({ level, rangeKm, rangeUnit = 'km', isCharging }: Props) {
  const { t } = useTranslation();
  const clampedLevel = Math.max(0, Math.min(100, level));
  const color = clampedLevel < 20 ? '#ef4444' : clampedLevel < 30 ? '#f97316' : clampedLevel < 50 ? '#eab308' : '#22c55e';
  const radius = 60;
  const stroke = 10;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clampedLevel / 100);

  return (
    <div className="flex flex-col items-center w-full h-full">
      <svg viewBox="0 0 160 160" className="w-full h-full max-w-[160px] max-h-[160px]">
        <circle
          cx={80} cy={80} r={radius}
          fill="none" stroke="#2a2a2a" strokeWidth={stroke}
        />
        <circle
          cx={80} cy={80} r={radius}
          fill="none" stroke={color} strokeWidth={stroke}
          strokeDasharray={circumference} strokeDashoffset={offset}
          strokeLinecap="round"
          transform="rotate(-90 80 80)"
          className="transition-all duration-500"
        />
        <text x={80} y={72} textAnchor="middle" fill="white" fontSize={36} fontWeight="bold">
          {clampedLevel}%
        </text>
        {rangeKm != null && (
          <text x={80} y={100} textAnchor="middle" fill="#9ca3af" fontSize={14}>
            {Math.round(rangeKm)} {rangeUnit}
          </text>
        )}
        {isCharging && (
          <text x={80} y={120} textAnchor="middle" fill="#3b82f6" fontSize={12}>
            ⚡ {t('battery.charging')}
          </text>
        )}
      </svg>
    </div>
  );
}
