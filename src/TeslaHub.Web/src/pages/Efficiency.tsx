import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useUnits } from '../hooks/useUnits';
import { getEfficiencySummary } from '../api/queries';
import StatCard from '../components/StatCard';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

export default function Efficiency({ carId }: { carId?: number }) {
  const { t } = useTranslation();
  const u = useUnits();

  const { data } = useQuery({
    queryKey: ['efficiency', carId],
    queryFn: () => getEfficiencySummary(carId!),
    enabled: !!carId,
    staleTime: 5 * 60_000,
  });

  if (!carId) return null;

  const tempData = data?.temperatureEfficiency ?? [];
  const chartData = tempData.map((d) => ({
    temp: u.convertTemp(d.temperatureC)?.toFixed(0),
    consumption: u.convertConsumption(d.consumptionKwhPer100Km),
    distance: u.convertDistance(d.totalDistanceKm),
  }));

  return (
    <div className="p-4 max-w-5xl mx-auto space-y-4">
      <h1 className="text-xl font-bold text-white">{t('efficiencyPage.title')}</h1>

      {data && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            <StatCard label={t('efficiencyPage.consumptionNet')} value={u.fmtConsumption(data.avgConsumptionNetKwhPer100Km)} unit={u.consumptionUnit} color="#3b82f6" />
            <StatCard label={t('efficiencyPage.consumptionGross')} value={u.fmtConsumption(data.avgConsumptionGrossKwhPer100Km)} unit={u.consumptionUnit} color="#f97316" />
            <StatCard label={t('efficiencyPage.totalDistance')} value={u.fmtDist(data.totalDistanceKm, 0)} unit={u.distanceUnit} color="#22c55e" />
            <StatCard label={t('efficiencyPage.currentEfficiency')} value={data.currentEfficiencyWhPerKm != null ? (u.convertConsumption(data.currentEfficiencyWhPerKm / 10))?.toFixed(1) ?? '—' : '—'} unit={u.consumptionUnit} color="#8b5cf6" />
          </div>

          {data.derivedEfficiencies && data.derivedEfficiencies.length > 0 && (
            <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl p-4">
              <h3 className="text-sm text-[#9ca3af] mb-2">{t('efficiencyPage.derivedEfficiencies')}</h3>
              <div className="space-y-1">
                {data.derivedEfficiencies.map((d, i) => (
                  <div key={i} className="flex justify-between text-sm">
                    <span className="text-[#9ca3af]">{u.fmtConsumption(d.efficiencyKwhPer100Km)} {u.consumptionUnit}</span>
                    <span className="text-white">{d.count}x</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {chartData.length > 0 && (
            <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl p-4">
              <h3 className="text-sm text-[#9ca3af] mb-3">{t('efficiencyPage.tempVsConsumption')}</h3>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" />
                  <XAxis dataKey="temp" tick={{ fill: '#9ca3af', fontSize: 10 }} label={{ value: u.tempUnit, position: 'insideBottom', offset: -5, fill: '#9ca3af', fontSize: 10 }} />
                  <YAxis tick={{ fill: '#9ca3af', fontSize: 10 }} />
                  <Tooltip contentStyle={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 8 }} />
                  <Bar dataKey="consumption" fill="#3b82f6" radius={[4, 4, 0, 0]} name={u.consumptionUnit} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </>
      )}
    </div>
  );
}
