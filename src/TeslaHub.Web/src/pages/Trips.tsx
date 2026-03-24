import { useDrives } from '../hooks/useDrives';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts';

interface Props {
  carId: number | undefined;
}

export default function Trips({ carId }: Props) {
  const { data: drives, isLoading } = useDrives(carId, 30);

  if (isLoading) {
    return <div className="flex items-center justify-center h-[60vh] text-[#9ca3af]">Loading...</div>;
  }

  const driveList = drives ?? [];

  const dailyData: Record<string, number> = {};
  driveList.forEach((d) => {
    const day = new Date(d.startDate).toLocaleDateString(undefined, { weekday: 'short', day: '2-digit' });
    dailyData[day] = (dailyData[day] ?? 0) + (d.distance ?? 0) / 1000;
  });

  const chartData = Object.entries(dailyData)
    .slice(-7)
    .map(([day, km]) => ({ day, km: Math.round(km) }));

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-xl font-bold">Trips</h1>

      {chartData.length > 0 && (
        <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl p-4">
          <div className="text-xs text-[#9ca3af] uppercase tracking-wider mb-3">Distance per day (km)</div>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={chartData}>
              <XAxis dataKey="day" tick={{ fill: '#9ca3af', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} axisLine={false} tickLine={false} width={35} />
              <Tooltip contentStyle={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8, color: '#fff' }} />
              <Bar dataKey="km" fill="#e31937" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="space-y-2">
        {driveList.map((drive) => (
          <div key={drive.id} className="bg-[#141414] border border-[#2a2a2a] rounded-xl p-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-medium">
                {drive.startAddress?.split(',')[0] ?? '?'}{' → '}{drive.endAddress?.split(',')[0] ?? '?'}
              </span>
              <span className="text-xs text-[#9ca3af]">
                {new Date(drive.startDate).toLocaleString(undefined, { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })}
              </span>
            </div>
            <div className="flex items-center gap-4 text-sm text-[#9ca3af]">
              <span>{drive.distance ? (drive.distance / 1000).toFixed(1) : '—'} km</span>
              <span>{drive.durationMin ?? '—'} min</span>
              {drive.consumptionKWhPer100Km != null && (
                <span>{drive.consumptionKWhPer100Km.toFixed(1)} kWh/100km</span>
              )}
              {drive.outsideTempAvg != null && <span>{Math.round(drive.outsideTempAvg)}°C</span>}
              {drive.speedMax != null && <span>Max {drive.speedMax} km/h</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
