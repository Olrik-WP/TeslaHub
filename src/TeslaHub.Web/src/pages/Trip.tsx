import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useUnits } from '../hooks/useUnits';
import { getTripSummary, getTripSegments } from '../api/queries';
import StatCard from '../components/StatCard';
import { utcDate } from '../utils/date';

interface Props {
  carId: number | undefined;
}

function defaultFromDate() {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d.toISOString().slice(0, 10);
}
function defaultToDate() {
  return new Date().toISOString().slice(0, 10);
}

export default function Trip({ carId }: Props) {
  const { t } = useTranslation();
  const u = useUnits();
  const [fromDate, setFromDate] = useState(defaultFromDate);
  const [fromTime, setFromTime] = useState('00:00');
  const [toDate, setToDate] = useState(defaultToDate);
  const [toTime, setToTime] = useState('23:59');

  const from = `${fromDate}T${fromTime}`;
  const to = `${toDate}T${toTime}`;

  const { data: summary, isLoading: sumLoading } = useQuery({
    queryKey: ['tripSummary', carId, from, to],
    queryFn: () => getTripSummary(carId!, from, to),
    enabled: !!carId && !!from && !!to,
  });

  const { data: segments, isLoading: segLoading } = useQuery({
    queryKey: ['tripSegments', carId, from, to],
    queryFn: () => getTripSegments(carId!, from, to),
    enabled: !!carId && !!from && !!to,
  });

  const isLoading = sumLoading || segLoading;

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-lg sm:text-xl font-bold text-white">{t('tripPage.title')}</h1>
      <p className="text-xs text-[#6b7280]">{t('tripPage.description')}</p>

      {/* Date range picker */}
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="text-xs text-[#9ca3af] block mb-1">{t('tripPage.from')}</label>
          <div className="flex gap-1">
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-white text-sm focus:border-[#e31937] focus:outline-none min-h-[40px]"
            />
            <input
              type="time"
              value={fromTime}
              onChange={(e) => setFromTime(e.target.value)}
              className="bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg px-2 py-2 text-white text-sm focus:border-[#e31937] focus:outline-none min-h-[40px] w-[90px]"
            />
          </div>
        </div>
        <div>
          <label className="text-xs text-[#9ca3af] block mb-1">{t('tripPage.to')}</label>
          <div className="flex gap-1">
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-white text-sm focus:border-[#e31937] focus:outline-none min-h-[40px]"
            />
            <input
              type="time"
              value={toTime}
              onChange={(e) => setToTime(e.target.value)}
              className="bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg px-2 py-2 text-white text-sm focus:border-[#e31937] focus:outline-none min-h-[40px] w-[90px]"
            />
          </div>
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-12 text-[#9ca3af]">{t('app.loading')}</div>
      )}

      {/* Summary */}
      {summary && !isLoading && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard
            label={t('tripPage.distance')}
            value={u.fmtDist(summary.totalDistanceKm)}
            unit={u.distanceUnit}
            color="#e31937"
          />
          <StatCard
            label={t('tripPage.drives')}
            value={summary.driveCount}
          />
          <StatCard
            label={t('tripPage.driveTime')}
            value={summary.totalDriveMin > 60
              ? `${Math.floor(summary.totalDriveMin / 60)}h${(summary.totalDriveMin % 60).toString().padStart(2, '0')}`
              : summary.totalDriveMin}
            unit={summary.totalDriveMin > 60 ? undefined : 'min'}
          />
          <StatCard
            label={t('tripPage.chargeTime')}
            value={summary.totalChargeMin > 60
              ? `${Math.floor(summary.totalChargeMin / 60)}h${(summary.totalChargeMin % 60).toString().padStart(2, '0')}`
              : summary.totalChargeMin}
            unit={summary.totalChargeMin > 60 ? undefined : 'min'}
          />
          <StatCard
            label={t('tripPage.energyUsed')}
            value={summary.totalEnergyUsedKwh.toFixed(1)}
            unit="kWh"
            color="#ef4444"
          />
          <StatCard
            label={t('tripPage.energyAdded')}
            value={summary.totalEnergyAddedKwh.toFixed(1)}
            unit="kWh"
            color="#22c55e"
          />
          {summary.avgConsumption != null && (
            <StatCard
              label={t('tripPage.avgConsumption')}
              value={u.fmtConsumption(summary.avgConsumption)}
              unit={u.consumptionUnit}
            />
          )}
          {summary.avgSpeedKmh != null && (
            <StatCard
              label={t('tripPage.avgSpeed')}
              value={Math.round(u.convertSpeed(summary.avgSpeedKmh)!)}
              unit={u.speedUnit}
            />
          )}
        </div>
      )}

      {/* Segments timeline */}
      {segments && segments.length > 0 && !isLoading && (
        <div className="space-y-2">
          <div className="text-xs text-[#9ca3af] uppercase tracking-wider">{t('tripPage.timeline')}</div>
          {segments.map((seg, i) => (
            <div
              key={`${seg.type}-${seg.id}`}
              className={`bg-[#141414] border rounded-xl p-3 sm:p-4 ${
                seg.type === 'drive' ? 'border-[#2a2a2a]' : 'border-[#3b82f6]/30'
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                  seg.type === 'drive'
                    ? 'bg-[#e31937]/20 text-[#e31937]'
                    : 'bg-[#3b82f6]/20 text-[#3b82f6]'
                }`}>
                  {seg.type === 'drive' ? `🚗 ${t('tripPage.drive')}` : `⚡ ${t('tripPage.charge')}`}
                </span>
                <span className="text-[10px] text-[#6b7280] tabular-nums ml-auto">#{i + 1}</span>
              </div>

              {seg.type === 'drive' ? (
                <>
                  <div className="text-sm text-white truncate">
                    {seg.startAddress?.split(',')[0] ?? '?'} → {seg.endAddress?.split(',')[0] ?? '?'}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-xs text-[#9ca3af]">
                    {seg.distanceKm != null && (
                      <span><span className="text-white font-medium">{u.fmtDist(seg.distanceKm)}</span> {u.distanceUnit}</span>
                    )}
                    {seg.durationMin != null && (
                      <span><span className="text-white font-medium">{seg.durationMin}</span> min</span>
                    )}
                    {seg.avgSpeedKmh != null && (
                      <span><span className="text-white font-medium">{Math.round(u.convertSpeed(seg.avgSpeedKmh)!)}</span> {u.speedUnit}</span>
                    )}
                    {seg.consumption != null && (seg.distanceKm ?? 0) >= 1 && (
                      <span><span className="text-white font-medium">{u.fmtConsumption(seg.consumption)}</span> {u.consumptionUnit}</span>
                    )}
                    {seg.energyKwh != null && (
                      <span><span className="text-white font-medium">{seg.energyKwh.toFixed(1)}</span> kWh</span>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <div className="text-sm text-white truncate">
                    {seg.startAddress?.split(',')[0] ?? '?'}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-xs text-[#9ca3af]">
                    {seg.energyKwh != null && (
                      <span><span className="text-white font-medium">{seg.energyKwh.toFixed(1)}</span> kWh</span>
                    )}
                    {seg.durationMin != null && (
                      <span><span className="text-white font-medium">{seg.durationMin}</span> min</span>
                    )}
                    {seg.startBattery != null && seg.endBattery != null && (
                      <span>{seg.startBattery}% → {seg.endBattery}%</span>
                    )}
                  </div>
                </>
              )}

              <div className="text-[10px] text-[#6b7280] mt-1 tabular-nums">
                {utcDate(seg.startDate).toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                {seg.endDate && (
                  <> → {utcDate(seg.endDate).toLocaleString(undefined, { hour: '2-digit', minute: '2-digit' })}</>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {segments && segments.length === 0 && !isLoading && (
        <div className="text-center text-[#9ca3af] py-8">{t('tripPage.noData')}</div>
      )}
    </div>
  );
}
