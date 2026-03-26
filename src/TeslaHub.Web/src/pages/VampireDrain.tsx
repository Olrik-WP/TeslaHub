import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, Cell } from 'recharts';
import { getVampireDrain } from '../api/queries';
import { useUnits } from '../hooks/useUnits';
import StatCard from '../components/StatCard';

interface Props {
  carId: number | undefined;
}

type DaysOption = 7 | 30 | 90 | null;
type IdleOption = 1 | 4 | 8 | 12;

const DAYS_OPTIONS: { label: string; value: DaysOption }[] = [
  { label: '7j', value: 7 },
  { label: '30j', value: 30 },
  { label: '90j', value: 90 },
  { label: 'Tout', value: null },
];

const IDLE_OPTIONS: IdleOption[] = [1, 4, 8, 12];

function drainColor(kwh: number | null): string {
  if (kwh == null) return '#6b7280';
  if (kwh < 0.2) return '#22c55e';
  if (kwh < 0.5) return '#f59e0b';
  return '#ef4444';
}

function socColor(diff: number | null): string {
  if (diff == null) return '#6b7280';
  const abs = Math.abs(diff);
  if (abs <= 1) return '#22c55e';
  if (abs <= 3) return '#f59e0b';
  return '#ef4444';
}

function standbyColor(ratio: number | null): string {
  if (ratio == null) return '#6b7280';
  if (ratio >= 0.85) return '#22c55e';
  if (ratio >= 0.30) return '#f59e0b';
  return '#ef4444';
}

function fmtDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return m > 0 ? `${h}h${m.toString().padStart(2, '0')}` : `${h}h`;
}

export default function VampireDrain({ carId }: Props) {
  const { t } = useTranslation();
  const u = useUnits();
  const [days, setDays] = useState<DaysOption>(30);
  const [idleHours, setIdleHours] = useState<IdleOption>(4);
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['vampire', carId, idleHours, days, page],
    queryFn: () => getVampireDrain(carId!, idleHours, days, page),
    enabled: !!carId,
  });

  const items = data?.items ?? [];
  const summary = data?.summary;
  const hasMore = items.length === 50;

  // Bar chart: last 20 sessions in chronological order
  const chartData = [...items]
    .slice(0, 20)
    .reverse()
    .map((s, i) => ({
      idx: i + 1,
      label: new Date(s.startDate).toLocaleDateString(undefined, { day: '2-digit', month: 'short' }),
      kwh: s.consumptionKwh != null ? Math.round(s.consumptionKwh * 1000) / 1000 : null,
    }));

  if (isLoading) {
    return <div className="flex items-center justify-center h-[60vh] text-[#9ca3af]">{t('app.loading')}</div>;
  }

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-xl font-bold">🧛 {t('vampire.title')}</h1>

      {/* Summary stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label={t('vampire.sessions')} value={summary?.sessionCount ?? 0} />
        <StatCard
          label={t('vampire.totalDrained')}
          value={summary ? (summary.totalKwh > 0 ? summary.totalKwh.toFixed(2) : '0') : '—'}
          unit="kWh"
          color="#f59e0b"
        />
        <StatCard
          label={t('vampire.avgDrain')}
          value={summary ? (summary.avgWh > 0 ? Math.round(summary.avgWh).toString() : '0') : '—'}
          unit="Wh"
          color="#ef4444"
        />
        <StatCard
          label={t('vampire.avgPower')}
          value={summary ? (summary.avgPowerW > 0 ? Math.round(summary.avgPowerW).toString() : '0') : '—'}
          unit="W"
          color="#8b5cf6"
        />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        {/* Days filter */}
        <div className="flex gap-1">
          {DAYS_OPTIONS.map((opt) => (
            <button
              key={String(opt.value)}
              onClick={() => { setDays(opt.value); setPage(1); }}
              className={`px-3 py-2 rounded-lg text-sm font-medium min-h-[40px] transition-colors ${
                days === opt.value ? 'bg-[#e31937] text-white' : 'bg-[#1a1a1a] text-[#9ca3af]'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Divider */}
        <div className="w-px h-6 bg-[#2a2a2a]" />

        {/* Idle hours filter */}
        <div className="flex items-center gap-1">
          <span className="text-xs text-[#6b7280] mr-1">{t('vampire.minIdle')}:</span>
          {IDLE_OPTIONS.map((h) => (
            <button
              key={h}
              onClick={() => { setIdleHours(h); setPage(1); }}
              className={`px-2.5 py-2 rounded-lg text-sm font-medium min-h-[40px] transition-colors ${
                idleHours === h ? 'bg-[#1a1a1a] border border-[#e31937] text-white' : 'bg-[#1a1a1a] text-[#9ca3af] border border-[#2a2a2a]'
              }`}
            >
              {h}h
            </button>
          ))}
        </div>
      </div>

      {/* Bar chart */}
      {chartData.length > 1 && (
        <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl p-3 sm:p-4">
          <div className="text-xs text-[#9ca3af] uppercase tracking-wider mb-3">
            {t('vampire.energyDrained')} (kWh)
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <XAxis dataKey="label" tick={{ fill: '#9ca3af', fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#9ca3af', fontSize: 10 }} axisLine={false} tickLine={false} width={40} />
              <Tooltip
                contentStyle={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8, color: '#fff', fontSize: 12 }}
                formatter={(value) => [`${Number(value).toFixed(3)} kWh`, t('vampire.energyDrained')]}
              />
              <Bar dataKey="kwh" radius={[4, 4, 0, 0]}>
                {chartData.map((entry, i) => (
                  <Cell key={i} fill={drainColor(entry.kwh)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div className="flex gap-3 mt-2 justify-center">
            <span className="flex items-center gap-1 text-[10px] text-[#9ca3af]">
              <span className="w-2 h-2 rounded-full bg-[#22c55e]" /> &lt;0.2 kWh
            </span>
            <span className="flex items-center gap-1 text-[10px] text-[#9ca3af]">
              <span className="w-2 h-2 rounded-full bg-[#f59e0b]" /> 0.2–0.5 kWh
            </span>
            <span className="flex items-center gap-1 text-[10px] text-[#9ca3af]">
              <span className="w-2 h-2 rounded-full bg-[#ef4444]" /> &gt;0.5 kWh
            </span>
          </div>
        </div>
      )}

      {/* Session list */}
      {items.length === 0 ? (
        <div className="text-center py-12 text-[#6b7280]">
          <p className="text-2xl mb-2">🧛</p>
          <p className="text-sm">{t('vampire.noData')}</p>
          <p className="text-xs mt-1">{t('vampire.noDataSub')}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item, i) => {
            const startD = new Date(item.startDate);
            const endD = new Date(item.endDate);
            const rangeDist = u.convertDistance(item.rangeDiffKm);
            const rangeLostH = u.convertDistance(item.rangeLostPerHourKm);

            return (
              <div key={i} className="bg-[#141414] border border-[#2a2a2a] rounded-xl p-3 sm:p-4">
                {/* Header */}
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-white">
                      {startD.toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      {' → '}
                      {endD.toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </div>
                    <div className="text-xs text-[#6b7280] mt-0.5">
                      ⏱ {fmtDuration(item.durationSec)}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {/* Standby badge */}
                    {item.standby != null && (
                      <span
                        className="text-xs px-2 py-0.5 rounded font-medium"
                        style={{ color: standbyColor(item.standby), backgroundColor: `${standbyColor(item.standby)}20` }}
                      >
                        {t('vampire.standby')} {Math.round(item.standby * 100)}%
                      </span>
                    )}
                    {/* Cold battery badge */}
                    {item.hasReducedRange && (
                      <span className="text-xs px-2 py-0.5 rounded bg-[#3b82f6]/20 text-[#3b82f6]" title={t('vampire.coldBattery')}>
                        ❄
                      </span>
                    )}
                  </div>
                </div>

                {/* Metrics row */}
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                  {/* SoC diff */}
                  {item.socDiff != null && (
                    <span className="flex items-center gap-1">
                      <span className="text-[#6b7280] text-xs">{t('vampire.socDiff')}</span>
                      <span
                        className="font-medium text-xs px-1.5 py-0.5 rounded"
                        style={{ color: socColor(item.socDiff), backgroundColor: `${socColor(item.socDiff)}20` }}
                      >
                        {item.socDiff > 0 ? '+' : ''}{item.socDiff.toFixed(0)}%
                      </span>
                    </span>
                  )}

                  {/* Energy */}
                  {item.consumptionKwh != null && !item.hasReducedRange && (
                    <span className="flex items-center gap-1">
                      <span className="text-[#6b7280] text-xs">⚡</span>
                      <span className="font-medium" style={{ color: drainColor(item.consumptionKwh) }}>
                        {item.consumptionKwh < 1
                          ? `${Math.round(item.consumptionKwh * 1000)} Wh`
                          : `${item.consumptionKwh.toFixed(2)} kWh`}
                      </span>
                    </span>
                  )}

                  {/* Avg power */}
                  {item.avgPowerW != null && !item.hasReducedRange && (
                    <span className="flex items-center gap-1">
                      <span className="text-[#6b7280] text-xs">∅</span>
                      <span className="text-[#d1d5db]">{Math.round(item.avgPowerW)} W</span>
                    </span>
                  )}

                  {/* Range loss */}
                  {rangeDist != null && !item.hasReducedRange && (
                    <span className="flex items-center gap-1">
                      <span className="text-[#6b7280] text-xs">📉</span>
                      <span className="text-[#d1d5db]">{rangeDist.toFixed(1)} {u.distanceUnit}</span>
                    </span>
                  )}

                  {/* Range loss per hour */}
                  {rangeLostH != null && !item.hasReducedRange && (
                    <span className="flex items-center gap-1">
                      <span className="text-[#6b7280] text-xs">{t('vampire.avgRangeLossH')}</span>
                      <span className="text-[#d1d5db]">{rangeLostH.toFixed(2)} {u.distanceUnit}/h</span>
                    </span>
                  )}
                </div>
              </div>
            );
          })}

          {/* Pagination */}
          <div className="flex items-center justify-between pt-2">
            <button
              disabled={page === 1}
              onClick={() => setPage(p => p - 1)}
              className="px-4 py-2 rounded-lg text-sm bg-[#1a1a1a] text-[#9ca3af] disabled:opacity-30 min-h-[40px] border border-[#2a2a2a] active:bg-[#2a2a2a]"
            >
              ← Prev
            </button>
            <span className="text-xs text-[#6b7280]">Page {page}</span>
            <button
              disabled={!hasMore}
              onClick={() => setPage(p => p + 1)}
              className="px-4 py-2 rounded-lg text-sm bg-[#1a1a1a] text-[#9ca3af] disabled:opacity-30 min-h-[40px] border border-[#2a2a2a] active:bg-[#2a2a2a]"
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
