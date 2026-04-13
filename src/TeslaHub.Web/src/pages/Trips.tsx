import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useDrives } from '../hooks/useDrives';
import { useUnits } from '../hooks/useUnits';
import { utcDate } from '../utils/date';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts';
import StatCard from '../components/StatCard';
import type { Drive } from '../api/queries';
import { getSettings, getCostSummary, getTeslaMateCostSummary } from '../api/queries';

interface Props {
  carId: number | undefined;
}

type PeriodKey = '7d' | '30d' | '90d' | 'all';

const PERIOD_OPTIONS: { key: PeriodKey; labelKey: string; days?: number }[] = [
  { key: '7d', labelKey: 'charging.7days', days: 7 },
  { key: '30d', labelKey: 'charging.30days', days: 30 },
  { key: '90d', labelKey: 'charging.90days', days: 90 },
  { key: 'all', labelKey: 'charging.all' },
];

function fmtDuration(min: number | null) {
  if (min == null || min <= 0) return '—';
  if (min < 60) return `${Math.round(min)}m`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m > 0 ? `${h}h${m}m` : `${h}h`;
}

function efficiencyColor(eff: number | null): string {
  if (eff == null) return '#9ca3af';
  if (eff >= 1.0) return '#22c55e';
  if (eff >= 0.8) return '#eab308';
  return '#ef4444';
}

export default function Trips({ carId }: Props) {
  const [period, setPeriod] = useState<PeriodKey>('30d');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const navigate = useNavigate();
  const u = useUnits();
  const { t } = useTranslation();

  const selectedPeriod = PERIOD_OPTIONS.find((p) => p.key === period)!;
  const { data: drives, isLoading } = useDrives(carId, 500, selectedPeriod.days);
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: getSettings, staleTime: 5 * 60_000 });
  const costSource = settings?.costSource ?? 'teslahub';
  const { data: costSummary } = useQuery({
    queryKey: ['trip-cost-summary', carId, costSource, period],
    queryFn: () =>
      costSource === 'teslahub'
        ? getCostSummary(carId!, 'all')
        : getTeslaMateCostSummary(carId!, 'all'),
    enabled: !!carId,
    staleTime: 5 * 60_000,
  });
  const avgPricePerKwh = costSummary?.avgPricePerKwh ?? null;

  if (isLoading) {
    return <div className="flex items-center justify-center h-[60vh] text-[#9ca3af]">{t('app.loading')}</div>;
  }

  const driveList = drives ?? [];

  const totalDist = driveList.reduce((sum, d) => sum + (u.convertDistance(d.distance) ?? 0), 0);
  const tripCount = driveList.length;
  const avgDistPerTrip = tripCount > 0 ? totalDist / tripCount : 0;
  const consumptionDrives = driveList.filter((d) => d.consumptionKWhPer100Km != null && d.distance != null && d.distance > 0);
  const avgConsumption = consumptionDrives.length > 0
    ? consumptionDrives.reduce((sum, d) => sum + d.consumptionKWhPer100Km! * d.distance!, 0)
      / consumptionDrives.reduce((sum, d) => sum + d.distance!, 0)
    : null;

  const dailyData: Record<string, number> = {};
  driveList.forEach((d) => {
    const day = utcDate(d.startDate).toLocaleDateString(undefined, { weekday: 'short', day: '2-digit' });
    dailyData[day] = (dailyData[day] ?? 0) + (u.convertDistance(d.distance) ?? 0);
  });

  const chartData = Object.entries(dailyData)
    .slice(-7)
    .map(([day, dist]) => ({ day, dist: Math.round(dist * 10) / 10 }));

  return (
    <div className="p-4 space-y-4">
      {/* Period selector */}
      <div className="flex flex-wrap gap-1">
        {PERIOD_OPTIONS.map((opt) => (
          <button
            key={opt.key}
            onClick={() => setPeriod(opt.key)}
            className={`px-3 py-2 rounded-lg text-sm font-medium min-h-[40px] transition-colors ${
              period === opt.key ? 'bg-[#e31937] text-white' : 'bg-[#1a1a1a] text-[#9ca3af]'
            }`}
          >
            {t(opt.labelKey)}
          </button>
        ))}
      </div>

      {/* Summary stats */}
      {tripCount > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label={t('trips.totalDistance')} value={Math.round(totalDist)} unit={u.distanceUnit} color="#e31937" />
          <StatCard label={t('trips.tripCount')} value={tripCount} />
          <StatCard
            label={t('trips.avgConsumption')}
            value={avgConsumption != null ? u.fmtConsumption(avgConsumption) : '—'}
            unit={avgConsumption != null ? u.consumptionUnit : undefined}
            color="#eab308"
          />
          <StatCard label={t('trips.avgPerTrip')} value={Math.round(avgDistPerTrip)} unit={u.distanceUnit} />
        </div>
      )}

      {chartData.length > 0 && (
        <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl p-4">
          <div className="text-xs text-[#9ca3af] uppercase tracking-wider mb-3">{`${t('trips.distPerDay')} (${u.distanceUnit})`}</div>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={chartData}>
              <XAxis dataKey="day" tick={{ fill: '#9ca3af', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} axisLine={false} tickLine={false} width={35} />
              <Tooltip contentStyle={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8, color: '#fff' }} />
              <Bar dataKey="dist" fill="#e31937" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="space-y-2">
        {driveList.map((drive) => (
          <TripCard
            key={drive.id}
            drive={drive}
            expanded={expandedId === drive.id}
            onToggle={() => setExpandedId(expandedId === drive.id ? null : drive.id)}
            onViewMap={() => navigate(`/map?driveId=${drive.id}`)}
            u={u}
            t={t}
            avgPricePerKwh={avgPricePerKwh}
          />
        ))}
        {driveList.length === 0 && (
          <div className="text-center text-[#9ca3af] py-8">{t('trips.noTrips')}</div>
        )}
      </div>
    </div>
  );
}

function TripCard({ drive, expanded, onToggle, onViewMap, u, t, avgPricePerKwh }: {
  drive: Drive;
  expanded: boolean;
  onToggle: () => void;
  onViewMap: () => void;
  u: ReturnType<typeof useUnits>;
  t: (key: string) => string;
  avgPricePerKwh: number | null;
}) {
  const effPct = drive.efficiency != null ? Math.round(drive.efficiency * 100) : null;
  const netWh = drive.netEnergyKwh != null ? Math.round(drive.netEnergyKwh * 1000) : null;
  const tripCost = drive.netEnergyKwh != null && avgPricePerKwh != null && avgPricePerKwh > 0
    ? drive.netEnergyKwh * avgPricePerKwh
    : null;

  return (
    <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl p-3 sm:p-4">
      {/* Header row */}
      <div className="flex items-center justify-between mb-1">
        <span
          className="text-sm font-medium truncate cursor-pointer active:text-[#e31937] flex-1 min-w-0"
          onClick={onViewMap}
        >
          {drive.startAddress?.split(',')[0] ?? '?'}{' → '}{drive.endAddress?.split(',')[0] ?? '?'}
        </span>
        <div className="flex items-center gap-2 flex-shrink-0 ml-2">
          <span className="text-xs text-[#9ca3af]">
            {utcDate(drive.startDate).toLocaleString(undefined, { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })}
            {drive.endDate && (
              <> → {utcDate(drive.endDate).toLocaleString(undefined, { hour: '2-digit', minute: '2-digit' })}</>
            )}
          </span>
          <button
            onClick={onToggle}
            className="w-9 h-9 flex items-center justify-center rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] text-[#9ca3af] active:bg-[#2a2a2a] transition-colors flex-shrink-0"
            aria-label={expanded ? 'Collapse' : 'Expand'}
          >
            <span className={`text-sm transition-transform duration-200 inline-block ${expanded ? 'rotate-180' : ''}`}>▼</span>
          </button>
        </div>
      </div>

      {/* Compact stats row */}
      <div className="flex items-center gap-3 text-sm text-[#9ca3af]">
        <span>{u.fmtDist(drive.distance)} {u.distanceUnit}</span>
        <span>{fmtDuration(drive.durationMin)}</span>
        {drive.startBatteryLevel != null && drive.endBatteryLevel != null && (
          <span>{Math.round(drive.startBatteryLevel)}% → {Math.round(drive.endBatteryLevel)}%</span>
        )}
        {tripCost != null && <span className="text-[#eab308]">{tripCost.toFixed(2)} {u.currencySymbol}</span>}
        {drive.hasReducedRange && <span title={t('trips.coldBattery')}>❄</span>}
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="mt-3 pt-3 border-t border-[#2a2a2a]">
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
            {/* Energy */}
            {netWh != null && (
              <div>
                <span className="text-[#9ca3af]">⚡ {t('trips.energy')}</span>
                <span className="ml-1 text-white font-medium">
                  {netWh >= 1000 ? `${(netWh / 1000).toFixed(1)} kWh` : `${netWh} Wh`}
                </span>
              </div>
            )}

            {/* Efficiency */}
            {effPct != null && (
              <div>
                <span className="text-[#9ca3af]">📊 {t('trips.efficiency')}</span>
                <span className="ml-1 font-medium" style={{ color: efficiencyColor(drive.efficiency) }}>{effPct}%</span>
              </div>
            )}

            {/* Avg speed */}
            {drive.speedAvg != null && (
              <div>
                <span className="text-[#9ca3af]">🏎 {t('trips.avgSpeed')}</span>
                <span className="ml-1 text-white font-medium">{u.fmtSpeed(drive.speedAvg)} {u.speedUnit}</span>
              </div>
            )}

            {/* Max speed */}
            {drive.speedMax != null && (
              <div>
                <span className="text-[#9ca3af]">🚀 {t('trips.maxSpeed')}</span>
                <span className="ml-1 text-white font-medium">{u.fmtSpeed(drive.speedMax)} {u.speedUnit}</span>
              </div>
            )}

            {/* Max power */}
            {drive.powerMax != null && (
              <div>
                <span className="text-[#9ca3af]">⚡ {t('trips.maxPower')}</span>
                <span className="ml-1 text-white font-medium">{drive.powerMax} kW</span>
              </div>
            )}

            {/* Temperature */}
            {drive.outsideTempAvg != null && (
              <div>
                <span className="text-[#9ca3af]">🌡 {t('trips.temperature')}</span>
                <span className="ml-1 text-white font-medium">{u.fmtTemp(drive.outsideTempAvg)}{u.tempUnit}</span>
                {drive.hasReducedRange && <span className="ml-1 text-[#3b82f6]" title={t('trips.coldBattery')}>❄</span>}
              </div>
            )}

            {/* Elevation */}
            {(drive.ascent != null || drive.descent != null) && (
              <div>
                <span className="text-[#9ca3af]">⛰ {t('trips.elevation')}</span>
                <span className="ml-1 text-white font-medium">
                  {drive.ascent != null && `↑${Math.round(drive.ascent)}m`}
                  {drive.ascent != null && drive.descent != null && ' '}
                  {drive.descent != null && `↓${Math.round(drive.descent)}m`}
                </span>
              </div>
            )}

            {/* Consumption */}
            {drive.consumptionKWhPer100Km != null && (
              <div>
                <span className="text-[#9ca3af]">📈 {t('trips.consumption')}</span>
                <span className="ml-1 text-white font-medium">{u.fmtConsumption(drive.consumptionKWhPer100Km)} {u.consumptionUnit}</span>
              </div>
            )}

            {/* Cost */}
            {tripCost != null && (
              <div>
                <span className="text-[#9ca3af]">💰 {t('trips.cost')}</span>
                <span className="ml-1 font-medium text-[#eab308]">{tripCost.toFixed(2)} {u.currencySymbol}</span>
              </div>
            )}
          </div>

          {/* View on map button */}
          <button
            onClick={onViewMap}
            className="mt-3 w-full py-2 rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] text-sm text-[#9ca3af] active:bg-[#2a2a2a] transition-colors"
          >
            🗺 {t('trips.viewOnMap')}
          </button>
        </div>
      )}
    </div>
  );
}
