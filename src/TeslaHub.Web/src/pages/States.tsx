import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useUnits } from '../hooks/useUnits';
import { getStatesTimeline, getTimeline } from '../api/queries';
import StatCard from '../components/StatCard';

type Tab = 'states' | 'timeline';

const STATE_COLORS: Record<string, string> = {
  driving: '#3b82f6',
  charging: '#22c55e',
  online: '#eab308',
  asleep: '#8b5cf6',
  offline: '#6b7280',
  updating: '#f97316',
};

const ACTION_ICONS: Record<string, string> = {
  driving: '🚗',
  charging: '🔋',
  parking: '🅿️',
  updating: '💾',
  missing: '❓',
};

function fmtDuration(min: number | null) {
  if (min == null || min <= 0) return '—';
  if (min < 60) return `${Math.round(min)}m`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export default function States({ carId }: { carId?: number }) {
  const { t } = useTranslation();
  const u = useUnits();
  const [tab, setTab] = useState<Tab>('states');
  const [days, setDays] = useState(7);

  const { data: statesData } = useQuery({
    queryKey: ['statesTimeline', carId, days],
    queryFn: () => getStatesTimeline(carId!, days),
    enabled: !!carId && tab === 'states',
    staleTime: 5 * 60_000,
  });

  const { data: timelineData } = useQuery({
    queryKey: ['timeline', carId, days],
    queryFn: () => getTimeline(carId!, days),
    enabled: !!carId && tab === 'timeline',
    staleTime: 5 * 60_000,
  });

  if (!carId) return null;

  const tabs: { key: Tab; labelKey: string }[] = [
    { key: 'states', labelKey: 'statesPage.statesTab' },
    { key: 'timeline', labelKey: 'statesPage.timelineTab' },
  ];

  const DAYS_OPTIONS = [1, 3, 7, 14, 30];

  return (
    <div className="p-4 max-w-5xl mx-auto space-y-4">
      <h1 className="text-xl font-bold text-white">{t('statesPage.title')}</h1>

      <div className="flex gap-1 bg-[#141414] rounded-xl p-1">
        {tabs.map((tb) => (
          <button
            key={tb.key}
            onClick={() => setTab(tb.key)}
            className={`flex-1 py-2 text-xs rounded-lg transition-colors ${
              tab === tb.key ? 'bg-[#2a2a2a] text-white' : 'text-[#9ca3af]'
            }`}
          >
            {t(tb.labelKey)}
          </button>
        ))}
      </div>

      <div className="flex gap-1 flex-wrap">
        {DAYS_OPTIONS.map((d) => (
          <button
            key={d}
            onClick={() => setDays(d)}
            className={`px-3 py-1.5 text-xs rounded-lg ${days === d ? 'bg-[#2a2a2a] text-white' : 'text-[#9ca3af]'}`}
          >
            {d}d
          </button>
        ))}
      </div>

      {tab === 'states' && statesData && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <StatCard label={t('statesPage.currentState')} value={statesData.currentState ?? '—'} color={STATE_COLORS[statesData.currentState ?? ''] ?? '#9ca3af'} />
            <StatCard label={t('statesPage.parkedPct')} value={statesData.parkedPct != null ? (statesData.parkedPct * 100).toFixed(1) : '—'} unit="%" color="#8b5cf6" />
            <StatCard label={t('statesPage.drivingPct')} value={statesData.drivingPct != null ? (statesData.drivingPct * 100).toFixed(1) : '—'} unit="%" color="#3b82f6" />
          </div>

          {statesData.segments && statesData.segments.length > 0 && (
            <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl p-4">
              <h3 className="text-sm text-[#9ca3af] mb-3">{t('statesPage.stateDistribution')}</h3>
              <div className="flex h-6 rounded-full overflow-hidden">
                {statesData.segments.map((seg, i) => (
                  <div
                    key={i}
                    className="h-full"
                    style={{ width: `${seg.pct * 100}%`, backgroundColor: STATE_COLORS[seg.state] ?? '#444', minWidth: seg.pct > 0.01 ? 2 : 0 }}
                    title={`${seg.state}: ${(seg.pct * 100).toFixed(1)}%`}
                  />
                ))}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
                {statesData.segments.filter((s) => s.pct > 0.005).map((seg, i) => (
                  <div key={i} className="flex items-center gap-1.5 text-xs">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: STATE_COLORS[seg.state] ?? '#444' }} />
                    <span className="text-[#9ca3af]">{seg.state} {(seg.pct * 100).toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {tab === 'timeline' && (
        <>
          {timelineData && timelineData.length > 0 ? (
            <div className="space-y-2">
              {timelineData.map((entry, i) => (
                <div key={i} className="bg-[#141414] border border-[#2a2a2a] rounded-xl p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span className="text-lg">{ACTION_ICONS[entry.action] ?? '❓'}</span>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-white truncate">
                          {entry.action === 'driving' && entry.endAddress ? `${entry.startAddress ?? '?'} → ${entry.endAddress}` : entry.startAddress ?? entry.action}
                        </div>
                        <div className="text-xs text-[#9ca3af] mt-0.5">
                          {new Date(entry.startDate).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          {' — '}{fmtDuration(entry.durationMin)}
                        </div>
                      </div>
                    </div>
                    <div className="text-right ml-2">
                      {entry.distanceKm != null && entry.distanceKm > 0 && (
                        <div className="text-xs text-white">{u.fmtDist(entry.distanceKm, 1)} {u.distanceUnit}</div>
                      )}
                      {entry.energyKwh != null && Math.abs(entry.energyKwh) > 0.01 && (
                        <div className="text-xs text-[#9ca3af]">{entry.energyKwh.toFixed(1)} kWh</div>
                      )}
                      {entry.socEnd != null && (
                        <div className="text-xs text-[#9ca3af]">SoC {entry.socEnd}%</div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center text-[#9ca3af] py-12">{t('statesPage.noData')}</div>
          )}
        </>
      )}
    </div>
  );
}
