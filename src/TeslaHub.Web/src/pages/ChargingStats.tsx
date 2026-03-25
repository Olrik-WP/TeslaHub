import { useQuery } from '@tanstack/react-query';
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, Line, ComposedChart,
  ZAxis,
} from 'recharts';
import { getChargingCurve } from '../api/queries';
import type { ChargingCurvePoint, ChargingCurveMedian } from '../api/queries';

interface Props {
  carId: number | undefined;
}

const SESSION_COLORS = [
  '#e31937', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7',
  '#06b6d4', '#ec4899', '#14b8a6', '#f97316', '#8b5cf6',
  '#10b981', '#ef4444', '#6366f1', '#84cc16', '#d946ef',
];

function buildSeriesBySession(points: ChargingCurvePoint[]) {
  const map = new Map<number, { label: string; data: { soC: number; power: number }[] }>();
  for (const p of points) {
    if (!map.has(p.chargingProcessId)) {
      map.set(p.chargingProcessId, { label: p.label ?? `#${p.chargingProcessId}`, data: [] });
    }
    map.get(p.chargingProcessId)!.data.push({ soC: p.soC, power: p.power });
  }
  return [...map.entries()].map(([id, v], i) => ({
    id, label: v.label, data: v.data, color: SESSION_COLORS[i % SESSION_COLORS.length],
  }));
}

export default function ChargingStats({ carId }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ['chargingCurve', carId],
    queryFn: () => getChargingCurve(carId!),
    enabled: !!carId,
  });

  const points = data?.points ?? [];
  const median = data?.median ?? [];
  const series = buildSeriesBySession(points);

  if (isLoading) {
    return <div className="flex items-center justify-center h-[60vh] text-[#9ca3af]">Loading...</div>;
  }

  if (points.length === 0) {
    return (
      <div className="p-4 sm:p-6 space-y-4">
        <h1 className="text-lg sm:text-xl font-bold text-white">DC Charging Curve</h1>
        <p className="text-[#9ca3af] text-sm">No DC charging data available yet.</p>
      </div>
    );
  }

  const maxPower = Math.max(...points.map(p => p.power), ...median.map(m => m.power));
  const yMax = Math.ceil(maxPower / 10) * 10 + 10;

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <h1 className="text-lg sm:text-xl font-bold text-white">DC Charging Curve</h1>
      <p className="text-[#6b7280] text-xs">
        Power (kW) vs State of Charge (%). Each color represents a different charging session.
        The white line shows the median power at each SoC level.
      </p>

      <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl p-3 sm:p-4">
        <ResponsiveContainer width="100%" height={400}>
          <ComposedChart margin={{ top: 10, right: 10, bottom: 20, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" />
            <XAxis
              dataKey="soC"
              type="number"
              domain={[0, 100]}
              tickCount={11}
              label={{ value: 'SoC %', position: 'insideBottom', offset: -10, fill: '#9ca3af', fontSize: 12 }}
              tick={{ fill: '#9ca3af', fontSize: 11 }}
              stroke="#2a2a2a"
            />
            <YAxis
              dataKey="power"
              type="number"
              domain={[0, yMax]}
              label={{ value: 'kW', angle: -90, position: 'insideLeft', fill: '#9ca3af', fontSize: 12 }}
              tick={{ fill: '#9ca3af', fontSize: 11 }}
              stroke="#2a2a2a"
            />
            <ZAxis range={[30, 30]} />
            <Tooltip
              contentStyle={{
                backgroundColor: '#1f1f1f',
                border: '1px solid #2a2a2a',
                borderRadius: 8,
                fontSize: 12,
              }}
              labelStyle={{ color: '#9ca3af' }}
              formatter={(value, name) => [`${Number(value)} kW`, name]}
              labelFormatter={(v) => `SoC: ${v}%`}
            />

            {series.map((s) => (
              <Scatter
                key={s.id}
                name={s.label}
                data={s.data}
                fill={s.color}
                opacity={0.8}
              />
            ))}

            <Line
              data={median}
              dataKey="power"
              name="Median"
              stroke="#ffffff"
              strokeWidth={2}
              dot={false}
              type="monotone"
              legendType="line"
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl p-3 sm:p-4">
        <h2 className="text-sm font-semibold text-white mb-2">Sessions ({series.length})</h2>
        <div className="flex flex-wrap gap-2">
          {series.map((s) => (
            <span
              key={s.id}
              className="inline-flex items-center gap-1.5 text-xs text-[#d1d5db] bg-[#1f1f1f] rounded-lg px-2 py-1"
            >
              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
