import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useUnits } from '../hooks/useUnits';
import { getPeriodicStats } from '../api/queries';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';

type Period = 'day' | 'week' | 'month' | 'year';

function fmtDuration(min: number | null) {
  if (min == null || min <= 0) return '—';
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h === 0) return `${m}m`;
  return m > 0 ? `${h}h${m}m` : `${h}h`;
}

export default function Statistics({ carId }: { carId?: number }) {
  const { t } = useTranslation();
  const u = useUnits();
  const [period, setPeriod] = useState<Period>('month');

  const { data: rows } = useQuery({
    queryKey: ['periodicStats', carId, period],
    queryFn: () => getPeriodicStats(carId!, period),
    enabled: !!carId,
    staleTime: 5 * 60_000,
  });

  const PERIODS: { key: Period; labelKey: string }[] = [
    { key: 'day', labelKey: 'statisticsPage.day' },
    { key: 'week', labelKey: 'statisticsPage.week' },
    { key: 'month', labelKey: 'statisticsPage.month' },
    { key: 'year', labelKey: 'statisticsPage.year' },
  ];

  const chartData = useMemo(() =>
    (rows ?? []).map((r) => ({
      label: r.label,
      distance: u.convertDistance(r.distanceKm),
      energy: r.energyAddedKwh,
    })),
    [rows, u],
  );

  if (!carId) return null;

  return (
    <div className="p-4 max-w-5xl mx-auto space-y-4">
      <h1 className="text-xl font-bold text-white">{t('statisticsPage.title')}</h1>

      <div className="flex gap-1 bg-[#141414] rounded-xl p-1">
        {PERIODS.map((p) => (
          <button
            key={p.key}
            onClick={() => setPeriod(p.key)}
            className={`flex-1 py-2 text-xs rounded-lg transition-colors ${
              period === p.key ? 'bg-[#2a2a2a] text-white' : 'text-[#9ca3af]'
            }`}
          >
            {t(p.labelKey)}
          </button>
        ))}
      </div>

      {chartData.length > 0 && (
        <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl p-4">
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" />
              <XAxis dataKey="label" tick={{ fill: '#9ca3af', fontSize: 9 }} interval={0} angle={-45} textAnchor="end" height={50} />
              <YAxis yAxisId="dist" tick={{ fill: '#9ca3af', fontSize: 10 }} />
              <YAxis yAxisId="kwh" orientation="right" tick={{ fill: '#9ca3af', fontSize: 10 }} />
              <Tooltip contentStyle={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 8 }} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Bar yAxisId="dist" dataKey="distance" fill="#3b82f6" radius={[4, 4, 0, 0]} name={u.distanceUnit} />
              <Bar yAxisId="kwh" dataKey="energy" fill="#22c55e" radius={[4, 4, 0, 0]} name="kWh" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {rows && rows.length > 0 ? (
        <>
          {/* Mobile: cards */}
          <div className="sm:hidden space-y-3">
            {rows.map((r, i) => (
              <div key={i} className="bg-[#141414] border border-[#2a2a2a] rounded-xl p-3">
                <div className="text-sm font-semibold text-white mb-2">{r.label}</div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <span className="text-[#9ca3af]">{u.distanceUnit}</span>
                  <span className="text-white text-right tabular-nums">{u.fmtDist(r.distanceKm, 0)}</span>
                  <span className="text-[#9ca3af]">{t('statisticsPage.drives')}</span>
                  <span className="text-white text-right tabular-nums">{r.driveCount}</span>
                  <span className="text-[#9ca3af]">{t('statisticsPage.duration')}</span>
                  <span className="text-white text-right tabular-nums">{fmtDuration(r.driveDurationMin)}</span>
                  <span className="text-[#9ca3af]">kWh</span>
                  <span className="text-white text-right tabular-nums">{r.energyAddedKwh?.toFixed(1) ?? '—'}</span>
                  <span className="text-[#9ca3af]">{t('statisticsPage.charges')}</span>
                  <span className="text-white text-right tabular-nums">{r.chargeCount}</span>
                  <span className="text-[#9ca3af]">{u.consumptionUnit}</span>
                  <span className="text-white text-right tabular-nums">{u.fmtConsumption(r.consumptionNetKwhPer100Km)}</span>
                  <span className="text-[#9ca3af]">°C</span>
                  <span className="text-white text-right tabular-nums">{r.avgTempC != null ? `${r.avgTempC.toFixed(1)}°` : '—'}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop: table */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="text-[#9ca3af] border-b border-[#2a2a2a]">
                  <th className="py-2 px-2 font-medium">{t('statisticsPage.period')}</th>
                  <th className="py-2 px-2 font-medium text-right">{u.distanceUnit}</th>
                  <th className="py-2 px-2 font-medium text-right">{t('statisticsPage.drives')}</th>
                  <th className="py-2 px-2 font-medium text-right">{t('statisticsPage.duration')}</th>
                  <th className="py-2 px-2 font-medium text-right">kWh</th>
                  <th className="py-2 px-2 font-medium text-right">{t('statisticsPage.charges')}</th>
                  <th className="py-2 px-2 font-medium text-right">{u.consumptionUnit}</th>
                  <th className="py-2 px-2 font-medium text-right">°C</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b border-[#1a1a1a] text-white">
                    <td className="py-2 px-2 whitespace-nowrap">{r.label}</td>
                    <td className="py-2 px-2 text-right tabular-nums">{u.fmtDist(r.distanceKm, 0)}</td>
                    <td className="py-2 px-2 text-right tabular-nums">{r.driveCount}</td>
                    <td className="py-2 px-2 text-right tabular-nums">{fmtDuration(r.driveDurationMin)}</td>
                    <td className="py-2 px-2 text-right tabular-nums">{r.energyAddedKwh?.toFixed(1) ?? '—'}</td>
                    <td className="py-2 px-2 text-right tabular-nums">{r.chargeCount}</td>
                    <td className="py-2 px-2 text-right tabular-nums">{u.fmtConsumption(r.consumptionNetKwhPer100Km)}</td>
                    <td className="py-2 px-2 text-right tabular-nums">{r.avgTempC != null ? `${r.avgTempC.toFixed(1)}°` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="text-center text-[#9ca3af] py-12">{t('statisticsPage.noData')}</div>
      )}
    </div>
  );
}
