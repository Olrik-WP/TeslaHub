import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { getCostSummary, getCostOverrides, getSettings, getTeslaMateCostSummary, getTeslaMateMonthlyTrend } from '../api/queries';
import { useUnits } from '../hooks/useUnits';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, PieChart, Pie, Cell } from 'recharts';
import StatCard from '../components/StatCard';

interface Props {
  carId: number | undefined;
}

const COLORS = ['#e31937', '#3b82f6', '#22c55e', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6'];

type PeriodMode = 'month' | 'year' | 'all';

export default function Costs({ carId }: Props) {
  const u = useUnits();
  const { t } = useTranslation();
  const now = new Date();
  const [periodMode, setPeriodMode] = useState<PeriodMode>('month');
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: getSettings });
  const costSource = settings?.costSource ?? 'teslahub';
  const isTeslaHub = costSource !== 'teslamate';

  const { data: summary } = useQuery({
    queryKey: [isTeslaHub ? 'costSummary' : 'tmCostSummary', carId, periodMode, year, month],
    queryFn: () => isTeslaHub
      ? getCostSummary(carId!, periodMode, year, periodMode === 'all' ? undefined : month)
      : getTeslaMateCostSummary(carId!, periodMode, year, periodMode === 'all' ? undefined : month),
    enabled: !!carId,
  });

  const { data: overrides } = useQuery({
    queryKey: ['costOverrides', carId],
    queryFn: () => getCostOverrides(carId!),
    enabled: !!carId && isTeslaHub,
  });

  const { data: tmTrend } = useQuery({
    queryKey: ['tmCostTrend', carId],
    queryFn: () => getTeslaMateMonthlyTrend(carId!),
    enabled: !!carId && !isTeslaHub,
  });

  const locationData = Object.entries(summary?.costByLocation ?? {}).map(([name, cost]) => ({
    name,
    cost: typeof cost === 'number' ? cost : 0,
  }));
  const totalLocCost = locationData.reduce((s, d) => s + d.cost, 0);

  const monthlyData = isTeslaHub
    ? buildMonthlyData(overrides ?? [])
    : (tmTrend ?? [])
        .slice()
        .sort((a, b) => a.month.localeCompare(b.month))
        .slice(-12)
        .map((t) => ({ month: t.month.slice(2), cost: Math.round(t.cost * 100) / 100 }));

  const handlePrev = () => {
    if (periodMode === 'month') {
      if (month === 1) { setMonth(12); setYear(year - 1); }
      else setMonth(month - 1);
    } else if (periodMode === 'year') {
      setYear(year - 1);
    }
  };

  const handleNext = () => {
    if (periodMode === 'month') {
      if (month === 12) { setMonth(1); setYear(year + 1); }
      else setMonth(month + 1);
    } else if (periodMode === 'year') {
      setYear(year + 1);
    }
  };

  const navLabel = periodMode === 'month'
    ? new Date(year, month - 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
    : periodMode === 'year'
      ? String(year)
      : t('costs.allTime');

  const costPerKm = summary?.costPerKm ?? 0;
  const totalKwh = summary?.totalKwh ?? 0;

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-xl font-bold">{t('costs.title')}</h1>

      {/* Period selector */}
      <div className="flex flex-wrap gap-1">
        {(['month', 'year', 'all'] as const).map((p) => (
          <button
            key={p}
            onClick={() => setPeriodMode(p)}
            className={`px-3 py-2 rounded-lg text-sm font-medium min-h-[40px] transition-colors ${
              periodMode === p ? 'bg-[#e31937] text-white' : 'bg-[#1a1a1a] text-[#9ca3af]'
            }`}
          >
            {p === 'month' ? t('costs.month') : p === 'year' ? t('costs.year') : t('costs.allTime')}
          </button>
        ))}
      </div>

      {/* Date navigation */}
      {periodMode !== 'all' && (
        <div className="flex items-center justify-between bg-[#141414] border border-[#2a2a2a] rounded-xl px-4 py-3">
          <button onClick={handlePrev} className="text-[#9ca3af] text-lg min-w-[44px] min-h-[44px] flex items-center justify-center">←</button>
          <span className="text-sm font-medium capitalize">{navLabel}</span>
          <button onClick={handleNext} className="text-[#9ca3af] text-lg min-w-[44px] min-h-[44px] flex items-center justify-center">→</button>
        </div>
      )}

      {/* Stats cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard label={t('costs.totalCost')} value={summary ? summary.totalCost.toFixed(2) : '—'} unit={u.currencySymbol} accent />
        <StatCard label={t('costs.sessions')} value={summary?.sessionCount ?? 0} />
        <StatCard label={t('costs.free')} value={summary?.freeSessionCount ?? 0} color="#22c55e" />
        <StatCard label={`${t('costs.avgPerKwh')} ${u.currencySymbol}/kWh`} value={summary?.avgPricePerKwh ? summary.avgPricePerKwh.toFixed(4) : '—'} />
        <StatCard label={t('costs.totalKwh')} value={totalKwh > 0 ? totalKwh.toFixed(1) : '—'} unit="kWh" color="#eab308" />
        <StatCard label={`${u.currencySymbol}/${u.distanceUnit}`} value={costPerKm > 0 ? costPerKm.toFixed(4) : '—'} />
      </div>

      {/* Cost by location */}
      {locationData.length > 0 && (
        <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl p-3 sm:p-4">
          <div className="text-xs text-[#9ca3af] uppercase tracking-wider mb-3">{t('costs.costByLocation')}</div>
          <div className="flex flex-col sm:flex-row items-center gap-4">
            <div className="w-40 h-40 sm:w-44 sm:h-44 flex-shrink-0 relative">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={locationData}
                    dataKey="cost"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={70}
                    innerRadius={40}
                    paddingAngle={2}
                  >
                    {locationData.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8, color: '#fff', fontSize: 12 }}
                    formatter={(value) => [`${Number(value).toFixed(2)} ${u.currencySymbol}`, '']}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <span className="text-sm font-bold text-white">{totalLocCost.toFixed(0)} {u.currencySymbol}</span>
              </div>
            </div>
            <div className="flex-1 w-full space-y-2 max-h-44 overflow-y-auto pr-1">
              {locationData.map((d, i) => {
                const pct = totalLocCost > 0 ? (d.cost / totalLocCost * 100) : 0;
                return (
                  <div key={d.name} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                      <span className="text-[#9ca3af] truncate">{d.name}</span>
                      <span className="text-[#6b7280] text-xs flex-shrink-0">{pct.toFixed(0)}%</span>
                    </div>
                    <span className="font-medium flex-shrink-0 ml-2">{d.cost.toFixed(2)} {u.currencySymbol}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Monthly trend */}
      {monthlyData.length > 1 && (
        <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl p-3 sm:p-4">
          <div className="text-xs text-[#9ca3af] uppercase tracking-wider mb-3">{t('costs.monthlyTrend')}</div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={monthlyData}>
              <XAxis dataKey="month" tick={{ fill: '#9ca3af', fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#9ca3af', fontSize: 10 }} axisLine={false} tickLine={false} width={40} />
              <Tooltip
                contentStyle={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8, color: '#fff', fontSize: 12 }}
                formatter={(value) => [`${Number(value).toFixed(2)} ${u.currencySymbol}`, t('costs.cost')]}
              />
              <Bar dataKey="cost" fill="#e31937" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Empty state */}
      {(!summary || summary.sessionCount === 0) && (
        <div className="text-center text-[#6b7280] py-8">
          <p className="text-sm">{t('costs.noData')}</p>
          <p className="text-xs mt-1">
            {isTeslaHub
              ? t('costs.setPrices')
              : t('costs.geofenceCosts')}
          </p>
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
    .slice(-12)
    .map(([month, cost]) => ({ month: month.slice(2), cost: Math.round(cost * 100) / 100 }));
}
