interface Props {
  label: string;
  value: string | number;
  unit?: string;
  accent?: boolean;
  color?: string;
}

export default function StatCard({ label, value, unit, accent, color }: Props) {
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
    </div>
  );
}
