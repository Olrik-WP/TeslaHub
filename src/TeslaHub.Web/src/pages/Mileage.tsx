import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useUnits } from '../hooks/useUnits';
import { useVehicleStatus } from '../hooks/useVehicle';
import { getMileageTimeSeries } from '../api/queries';
import StatCard from '../components/StatCard';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

export default function Mileage({ carId }: { carId?: number }) {
  const { t } = useTranslation();
  const u = useUnits();
  const [days, setDays] = useState(365);

  const { data: vehicle } = useVehicleStatus(carId);
  const { data: series } = useQuery({
    queryKey: ['mileage', carId, days],
    queryFn: () => getMileageTimeSeries(carId!, days),
    enabled: !!carId,
    staleTime: 5 * 60_000,
  });

  if (!carId) return null;

  const DAYS_OPTIONS = [90, 180, 365, 0];
  const fmtDate = (d: unknown) => new Date(String(d)).toLocaleDateString(undefined, { month: 'short', year: '2-digit' });

  const chartData = series?.map((p) => ({
    date: p.date,
    odometer: u.convertDistance(p.odometerKm),
  })) ?? [];

  const odometer = u.convertDistance(vehicle?.odometer ?? null);

  return (
    <div className="p-4 max-w-5xl mx-auto space-y-4">
      <h1 className="text-xl font-bold text-white">{t('mileagePage.title')}</h1>

      <div className="grid grid-cols-2 gap-3">
        <StatCard label={t('mileagePage.odometer')} value={odometer != null ? odometer.toFixed(0) : '—'} unit={u.distanceUnit} color="#3b82f6" />
        <StatCard label={t('mileagePage.dataPoints')} value={series?.length ?? '—'} color="#9ca3af" />
      </div>

      <div className="flex gap-1 flex-wrap">
        {DAYS_OPTIONS.map((d) => (
          <button
            key={d}
            onClick={() => setDays(d)}
            className={`px-3 py-1.5 text-xs rounded-lg ${days === d ? 'bg-[#2a2a2a] text-white' : 'text-[#9ca3af]'}`}
          >
            {d === 0 ? t('mileagePage.all') : `${d}d`}
          </button>
        ))}
      </div>

      {chartData.length > 0 ? (
        <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl p-4">
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" />
              <XAxis dataKey="date" tick={{ fill: '#9ca3af', fontSize: 10 }} tickFormatter={fmtDate} />
              <YAxis tick={{ fill: '#9ca3af', fontSize: 10 }} />
              <Tooltip contentStyle={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 8 }} labelFormatter={fmtDate} />
              <Line type="monotone" dataKey="odometer" stroke="#3b82f6" dot={false} strokeWidth={2} name={`${t('mileagePage.odometer')} (${u.distanceUnit})`} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="text-center text-[#9ca3af] py-12">{t('mileagePage.noData')}</div>
      )}
    </div>
  );
}
