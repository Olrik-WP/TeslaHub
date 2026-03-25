import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getCostSummary, getCostOverrides } from '../api/queries';
import { useUnits } from '../hooks/useUnits';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, PieChart, Pie, Cell } from 'recharts';
import StatCard from '../components/StatCard';

interface Props {
  carId: number | undefined;
}

const COLORS = ['#e31937', '#3b82f6', '#22c55e', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6'];

export default function Costs({ carId }: Props) {
  const u = useUnits();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const { data: summary } = useQuery({
    queryKey: ['costSummary', carId, year, month],
    queryFn: () => getCostSummary(carId!, year, month),
    enabled: !!carId,
  });

  const { data: overrides } = useQuery({
    queryKey: ['costOverrides', carId],
    queryFn: () => getCostOverrides(carId!),
    enabled: !!carId,
  });

  const locationData = Object.entries(summary?.costByLocation ?? {}).map(([name, cost]) => ({
    name,
    cost,
  }));

  const monthlyData = buildMonthlyData(overrides ?? []);

  const handlePrevMonth = () => {
    if (month === 1) { setMonth(12); setYear(year - 1); }
    else setMonth(month - 1);
  };

  const handleNextMonth = () => {
    if (month === 12) { setMonth(1); setYear(year + 1); }
    else setMonth(month + 1);
  };

  const monthLabel = new Date(year, month - 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-xl font-bold">Costs</h1>

      <div className="flex items-center justify-between bg-[#141414] border border-[#2a2a2a] rounded-xl px-4 py-3">
        <button onClick={handlePrevMonth} className="text-[#9ca3af] text-lg min-w-[44px] min-h-[44px] flex items-center justify-center">←</button>
        <span className="text-sm font-medium capitalize">{monthLabel}</span>
        <button onClick={handleNextMonth} className="text-[#9ca3af] text-lg min-w-[44px] min-h-[44px] flex items-center justify-center">→</button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Total cost" value={summary?.totalCost.toFixed(2) ?? '—'} unit={u.currencySymbol} accent />
        <StatCard label="Sessions" value={summary?.sessionCount ?? 0} />
        <StatCard label="Free" value={summary?.freeSessionCount ?? 0} color="#22c55e" />
        <StatCard
          label={`Avg ${u.currencySymbol}/kWh`}
          value={summary?.avgPricePerKwh ? summary.avgPricePerKwh.toFixed(4) : '—'}
          unit={u.currencySymbol}
        />
      </div>

      {locationData.length > 0 && (
        <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl p-4">
          <div className="text-xs text-[#9ca3af] uppercase tracking-wider mb-3">Cost by location</div>
          <div className="flex items-center gap-4">
            <div className="w-32 h-32">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={locationData} dataKey="cost" nameKey="name" cx="50%" cy="50%" outerRadius={55} innerRadius={30}>
                    {locationData.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex-1 space-y-2">
              {locationData.map((d, i) => (
                <div key={d.name} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                    <span className="text-[#9ca3af]">{d.name}</span>
                  </div>
                  <span className="font-medium">{d.cost.toFixed(2)} {u.currencySymbol}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {monthlyData.length > 1 && (
        <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl p-4">
          <div className="text-xs text-[#9ca3af] uppercase tracking-wider mb-3">Monthly trend</div>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={monthlyData}>
              <XAxis dataKey="month" tick={{ fill: '#9ca3af', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} axisLine={false} tickLine={false} width={40} />
              <Tooltip contentStyle={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8, color: '#fff' }} />
              <Bar dataKey="cost" fill="#e31937" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {(!summary || summary.sessionCount === 0) && (
        <div className="text-center text-[#6b7280] py-8">
          <p className="text-sm">No cost data for this month.</p>
          <p className="text-xs mt-1">Set prices on your charging sessions to see analytics here.</p>
        </div>
      )}
    </div>
  );
}

function buildMonthlyData(overrides: { totalCost: number; createdAt?: string }[]) {
  const map = new Map<string, number>();
  for (const o of overrides) {
    if (!o.createdAt) continue;
    const d = new Date(o.createdAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    map.set(key, (map.get(key) ?? 0) + o.totalCost);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-6)
    .map(([month, cost]) => ({ month: month.slice(2), cost: Math.round(cost * 100) / 100 }));
}
