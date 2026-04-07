import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useUnits } from '../hooks/useUnits';
import { useVehicleStatus } from '../hooks/useVehicle';
import { getBatteryHealth, getChargeLevelTimeSeries, getProjectedRange } from '../api/queries';
import StatCard from '../components/StatCard';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine } from 'recharts';

type Tab = 'health' | 'chargeLevel' | 'projectedRange';

export default function Battery({ carId }: { carId?: number }) {
  const { t } = useTranslation();
  const u = useUnits();
  const [tab, setTab] = useState<Tab>('health');
  const [days, setDays] = useState(90);

  const { data: vehicle } = useVehicleStatus(carId);
  const { data: health } = useQuery({
    queryKey: ['batteryHealth', carId],
    queryFn: () => getBatteryHealth(carId!),
    enabled: !!carId,
    staleTime: 5 * 60_000,
  });

  const { data: chargeLevel } = useQuery({
    queryKey: ['chargeLevel', carId, days],
    queryFn: () => getChargeLevelTimeSeries(carId!, days),
    enabled: !!carId && tab === 'chargeLevel',
    staleTime: 5 * 60_000,
  });

  const { data: projectedRange } = useQuery({
    queryKey: ['projectedRange', carId, days],
    queryFn: () => getProjectedRange(carId!, days),
    enabled: !!carId && tab === 'projectedRange',
    staleTime: 5 * 60_000,
  });

  if (!carId) return null;

  const tabs: { key: Tab; labelKey: string }[] = [
    { key: 'health', labelKey: 'batteryPage.health' },
    { key: 'chargeLevel', labelKey: 'batteryPage.chargeLevel' },
    { key: 'projectedRange', labelKey: 'batteryPage.projectedRange' },
  ];

  const DAYS_OPTIONS = [30, 90, 180, 365];

  const fmtDate = (d: unknown) => new Date(String(d)).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  return (
    <div className="p-4 max-w-5xl mx-auto space-y-4">
      <h1 className="text-xl font-bold text-white">{t('batteryPage.title')}</h1>

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

      {tab === 'health' && health && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            <StatCard label={t('batteryPage.currentCapacity')} value={health.currentCapacityKwh?.toFixed(1) ?? '—'} unit="kWh" color="#3b82f6" />
            <StatCard label={t('batteryPage.maxCapacity')} value={health.maxCapacityKwh?.toFixed(1) ?? '—'} unit="kWh" color="#22c55e" />
            <StatCard label={t('batteryPage.degradation')} value={health.degradationPct?.toFixed(1) ?? '—'} unit="%" color="#f97316" />
            <StatCard label={t('batteryPage.healthPct')} value={health.healthPct?.toFixed(1) ?? '—'} unit="%" color="#22c55e" progress={health.healthPct} />
            <StatCard label={t('batteryPage.soc')} value={vehicle?.batteryLevel?.toFixed(0) ?? '—'} unit="%" color="#eab308" progress={vehicle?.batteryLevel} />
            <StatCard label={t('batteryPage.storedEnergy')} value={health.storedEnergyKwh?.toFixed(1) ?? '—'} unit="kWh" color="#8b5cf6" />
            <StatCard label={t('batteryPage.chargeCount')} value={health.chargeCount ?? '—'} color="#9ca3af" />
            <StatCard label={t('batteryPage.chargeCycles')} value={health.chargeCycles?.toFixed(0) ?? '—'} color="#9ca3af" />
            <StatCard label={t('batteryPage.totalEnergyAdded')} value={health.totalEnergyAddedKwh?.toFixed(0) ?? '—'} unit="kWh" color="#3b82f6" />
            <StatCard label={t('batteryPage.chargingEfficiency')} value={health.chargingEfficiencyPct != null ? (health.chargingEfficiencyPct * 100).toFixed(1) : '—'} unit="%" color="#22c55e" />
          </div>

          {health.capacityByMileage && health.capacityByMileage.length > 0 && (
            <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl p-4">
              <h3 className="text-sm text-[#9ca3af] mb-3">{t('batteryPage.capacityByMileage')}</h3>
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={health.capacityByMileage}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" />
                  <XAxis dataKey="odometerKm" tick={{ fill: '#9ca3af', fontSize: 10 }} tickFormatter={(v) => `${u.convertDistance(v)?.toFixed(0)}`} />
                  <YAxis tick={{ fill: '#9ca3af', fontSize: 10 }} domain={['auto', 'auto']} />
                  <Tooltip contentStyle={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 8 }} labelFormatter={(v) => `${u.convertDistance(Number(v))?.toFixed(0)} ${u.distanceUnit}`} />
                  <Line type="monotone" dataKey="capacityKwh" stroke="#3b82f6" dot={false} strokeWidth={2} name="kWh" />
                  {health.medianCapacity != null && (
                    <ReferenceLine y={health.medianCapacity} stroke="#f97316" strokeDasharray="5 5" label={{ value: `Median: ${health.medianCapacity.toFixed(1)}`, position: 'right', fill: '#f97316', fontSize: 10 }} />
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </>
      )}

      {tab === 'chargeLevel' && (
        <>
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
          {chargeLevel && chargeLevel.length > 0 ? (
            <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl p-4">
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={chargeLevel}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" />
                  <XAxis dataKey="date" tick={{ fill: '#9ca3af', fontSize: 10 }} tickFormatter={fmtDate} />
                  <YAxis domain={[0, 100]} tick={{ fill: '#9ca3af', fontSize: 10 }} />
                  <Tooltip contentStyle={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 8 }} labelFormatter={fmtDate} />
                  <Line type="stepAfter" dataKey="batteryLevel" stroke="#22c55e" dot={false} strokeWidth={1.5} name={t('batteryPage.batteryLevelPct')} />
                  <Line type="stepAfter" dataKey="usableBatteryLevel" stroke="#3b82f6" dot={false} strokeWidth={1.5} name={t('batteryPage.usableLevelPct')} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="text-center text-[#9ca3af] py-12">{t('batteryPage.noData')}</div>
          )}
        </>
      )}

      {tab === 'projectedRange' && (
        <>
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
          {projectedRange && projectedRange.length > 0 ? (
            <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl p-4">
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={projectedRange}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" />
                  <XAxis dataKey="date" tick={{ fill: '#9ca3af', fontSize: 10 }} tickFormatter={fmtDate} />
                  <YAxis yAxisId="range" tick={{ fill: '#9ca3af', fontSize: 10 }} />
                  <YAxis yAxisId="soc" orientation="right" domain={[0, 100]} tick={{ fill: '#9ca3af', fontSize: 10 }} />
                  <Tooltip contentStyle={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 8 }} labelFormatter={fmtDate} />
                  <Line yAxisId="range" type="monotone" dataKey="projectedRangeKm" stroke="#3b82f6" dot={false} strokeWidth={2} name={`${t('batteryPage.projectedRange')} (${u.distanceUnit})`} />
                  <Line yAxisId="soc" type="monotone" dataKey="batteryLevel" stroke="#22c55e" dot={false} strokeWidth={1} name="SoC %" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="text-center text-[#9ca3af] py-12">{t('batteryPage.noData')}</div>
          )}
        </>
      )}
    </div>
  );
}
