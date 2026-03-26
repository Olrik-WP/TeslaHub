import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useDrives } from '../hooks/useDrives';
import { useUnits } from '../hooks/useUnits';
import { utcDate } from '../utils/date';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts';
import type { Drive } from '../api/queries';

interface Props {
  carId: number | undefined;
}

function efficiencyColor(eff: number | null): string {
  if (eff == null) return '#9ca3af';
  if (eff >= 1.0) return '#22c55e';
  if (eff >= 0.8) return '#eab308';
  return '#ef4444';
}

export default function Trips({ carId }: Props) {
  const { data: drives, isLoading } = useDrives(carId, 30);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const navigate = useNavigate();
  const u = useUnits();
  const { t } = useTranslation();

  if (isLoading) {
    return <div className="flex items-center justify-center h-[60vh] text-[#9ca3af]">{t('app.loading')}</div>;
  }

  const driveList = drives ?? [];

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
      <h1 className="text-xl font-bold">{t('trips.title')}</h1>

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
          />
        ))}
      </div>
    </div>
  );
}

function TripCard({ drive, expanded, onToggle, onViewMap, u, t }: {
  drive: Drive;
  expanded: boolean;
  onToggle: () => void;
  onViewMap: () => void;
  u: ReturnType<typeof useUnits>;
  t: (key: string) => string;
}) {
  const effPct = drive.efficiency != null ? Math.round(drive.efficiency * 100) : null;
  const netWh = drive.netEnergyKwh != null ? Math.round(drive.netEnergyKwh * 1000) : null;

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
        <span>{drive.durationMin ?? '—'} min</span>
        {drive.startBatteryLevel != null && drive.endBatteryLevel != null && (
          <span>{Math.round(drive.startBatteryLevel)}% → {Math.round(drive.endBatteryLevel)}%</span>
        )}
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
