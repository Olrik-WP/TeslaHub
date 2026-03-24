import { useChargingSessions } from '../hooks/useCharging';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts';

interface Props {
  carId: number | undefined;
}

export default function Charging({ carId }: Props) {
  const { data: sessions, isLoading } = useChargingSessions(carId, 30);

  if (isLoading) {
    return <div className="flex items-center justify-center h-[60vh] text-[#9ca3af]">Loading...</div>;
  }

  const activeSession = sessions?.find((s) => !s.endDate);
  const completedSessions = sessions?.filter((s) => s.endDate) ?? [];

  const chartData = completedSessions
    .slice(0, 15)
    .reverse()
    .map((s) => ({
      date: new Date(s.startDate).toLocaleDateString(undefined, { day: '2-digit', month: 'short' }),
      kwh: s.chargeEnergyAdded ?? 0,
      type: s.fastChargerPresent ? 'super' : 'home',
    }));

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-xl font-bold">Charging</h1>

      {activeSession && (
        <div className="bg-[#141414] border border-[#3b82f6]/30 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[#3b82f6] text-xl">⚡</span>
            <span className="font-medium">Charging now</span>
            {activeSession.address && (
              <span className="text-[#9ca3af] text-sm ml-auto">{activeSession.address.split(',')[0]}</span>
            )}
          </div>
          <div className="flex items-center gap-6 text-sm">
            <div>
              <span className="text-[#9ca3af]">Added: </span>
              <span className="font-medium">{activeSession.chargeEnergyAdded?.toFixed(1) ?? '—'} kWh</span>
            </div>
            <div>
              <span className="text-[#9ca3af]">Battery: </span>
              <span className="font-medium">{activeSession.startBatteryLevel}% → ?%</span>
            </div>
            <div>
              <span className="text-[#9ca3af]">Duration: </span>
              <span className="font-medium">{activeSession.durationMin ?? '—'} min</span>
            </div>
          </div>
        </div>
      )}

      {chartData.length > 0 && (
        <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl p-4">
          <div className="text-xs text-[#9ca3af] uppercase tracking-wider mb-3">Energy added (kWh)</div>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={chartData}>
              <XAxis dataKey="date" tick={{ fill: '#9ca3af', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} axisLine={false} tickLine={false} width={35} />
              <Tooltip
                contentStyle={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8, color: '#fff' }}
              />
              <Bar dataKey="kwh" fill="#3b82f6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="space-y-2">
        {completedSessions.map((session) => (
          <div key={session.id} className="bg-[#141414] border border-[#2a2a2a] rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">
                {new Date(session.startDate).toLocaleDateString()}
                {' · '}
                {session.address?.split(',')[0] ?? 'Unknown'}
              </span>
              <span className={`text-xs px-2 py-0.5 rounded ${session.fastChargerPresent ? 'bg-[#f59e0b]/20 text-[#f59e0b]' : 'bg-[#3b82f6]/20 text-[#3b82f6]'}`}>
                {session.fastChargerPresent ? 'Supercharger' : 'AC'}
              </span>
            </div>
            <div className="flex items-center gap-4 text-sm text-[#9ca3af]">
              <span>{session.chargeEnergyAdded?.toFixed(1) ?? '—'} kWh</span>
              <span>{session.durationMin ?? '—'} min</span>
              <span>{session.startBatteryLevel}% → {session.endBatteryLevel}%</span>
              {session.outsideTempAvg != null && <span>{Math.round(session.outsideTempAvg)}°C</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
