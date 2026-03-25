interface Props {
  label: string;
  value: string | number;
  unit?: string;
  accent?: boolean;
  color?: string;
  progress?: number | null;
}

function progressColor(pct: number) {
  if (pct < 20) return '#ef4444';
  if (pct < 30) return '#f97316';
  if (pct < 50) return '#eab308';
  return '#22c55e';
}

export default function StatCard({ label, value, unit, accent, color, progress }: Props) {
  const hasBar = progress != null && progress >= 0;
  return (
    <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl p-4 flex flex-col justify-between min-h-[100px]">
      <span className="text-[#9ca3af] text-xs uppercase tracking-wider">{label}</span>
      <div className="mt-2">
        <span
          className="text-3xl font-bold tabular-nums"
          style={{ color: accent ? '#e31937' : color || '#ffffff' }}
        >
          {value}
        </span>
        {unit && <span className="text-[#9ca3af] text-sm ml-1">{unit}</span>}
      </div>
      {hasBar && (
        <div className="mt-2 h-2 rounded-full bg-[#2a2a2a] overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{
              width: `${Math.min(progress, 100)}%`,
              backgroundColor: progressColor(progress),
            }}
          />
        </div>
      )}
    </div>
  );
}
