import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts';
import { useChargingSessions } from '../hooks/useCharging';
import { getCostOverrides, getSuggestedPrice, getMatchingLocation } from '../api/queries';
import { api } from '../api/client';
import type { ChargingSession, CostOverride, ChargingLocation } from '../api/queries';

interface Props {
  carId: number | undefined;
}

export default function Charging({ carId }: Props) {
  const { data: sessions, isLoading } = useChargingSessions(carId, 30);
  const { data: overrides } = useQuery({
    queryKey: ['costOverrides', carId],
    queryFn: () => getCostOverrides(carId!),
    enabled: !!carId,
  });

  if (isLoading) {
    return <div className="flex items-center justify-center h-[60vh] text-[#9ca3af]">Loading...</div>;
  }

  const overrideMap = new Map(overrides?.map((o) => [o.chargingProcessId, o]));
  const activeSession = sessions?.find((s) => !s.endDate);
  const completedSessions = sessions?.filter((s) => s.endDate) ?? [];

  const chartData = completedSessions
    .slice(0, 15)
    .reverse()
    .map((s) => ({
      date: new Date(s.startDate).toLocaleDateString(undefined, { day: '2-digit', month: 'short' }),
      kwh: s.chargeEnergyAdded ?? 0,
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
              <Tooltip contentStyle={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8, color: '#fff' }} />
              <Bar dataKey="kwh" fill="#3b82f6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="space-y-2">
        {completedSessions.map((session) => (
          <SessionCard
            key={session.id}
            session={session}
            override={overrideMap.get(session.id)}
            carId={carId}
          />
        ))}
      </div>
    </div>
  );
}

function SessionCard({ session, override: costOverride, carId }: {
  session: ChargingSession;
  override: CostOverride | undefined;
  carId: number | undefined;
}) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [inputMode, setInputMode] = useState<'total' | 'kwh'>('total');
  const [priceInput, setPriceInput] = useState(costOverride?.totalCost?.toString() ?? '');
  const [showLocationForm, setShowLocationForm] = useState(false);

  useQuery({
    queryKey: ['suggestPrice', session.latitude, session.longitude, carId],
    queryFn: () => getSuggestedPrice(session.latitude!, session.longitude!, carId!),
    enabled: expanded && !costOverride && session.latitude != null && session.longitude != null && !!carId,
    onSuccess: (data: { suggestedPrice: number | null }) => {
      if (data.suggestedPrice != null && !priceInput) {
        setInputMode('kwh');
        setPriceInput(data.suggestedPrice.toString());
      }
    },
  } as any);

  const saveCost = useMutation({
    mutationFn: (data: { pricePerKwh?: number | null; totalCost?: number | null; isFree: boolean }) =>
      api('/costs/session', {
        method: 'POST',
        body: JSON.stringify({
          chargingProcessId: session.id,
          carId: session.carId,
          pricePerKwh: data.pricePerKwh ?? null,
          totalCost: data.totalCost ?? null,
          isFree: data.isFree,
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['costOverrides'] });
      setExpanded(false);
    },
  });

  const handleSave = () => {
    const value = parseFloat(priceInput);
    if (isNaN(value)) return;
    if (inputMode === 'total') {
      saveCost.mutate({ totalCost: value, isFree: false });
    } else {
      saveCost.mutate({ pricePerKwh: value, isFree: false });
    }
  };

  const handleFree = () => {
    saveCost.mutate({ isFree: true });
  };

  const kwh = session.chargeEnergyAdded ?? session.chargeEnergyUsed ?? 0;
  const displayCost = costOverride
    ? costOverride.isFree
      ? 'Free'
      : `${costOverride.totalCost.toFixed(2)} €`
    : null;

  const previewText = (() => {
    const value = parseFloat(priceInput);
    if (isNaN(value)) return null;
    if (inputMode === 'total') {
      const effectiveKwh = kwh > 0 ? (value / kwh).toFixed(4) : '—';
      return `${value.toFixed(2)} € — effective ${effectiveKwh} €/kWh`;
    }
    return `Total: ${(value * kwh).toFixed(2)} € for ${kwh.toFixed(1)} kWh`;
  })();

  return (
    <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl p-4">
      <div className="flex items-center justify-between mb-2" onClick={() => setExpanded(!expanded)}>
        <span className="text-sm font-medium">
          {new Date(session.startDate).toLocaleDateString()}
          {' · '}
          {session.address?.split(',')[0] ?? 'Unknown'}
        </span>
        <div className="flex items-center gap-2">
          {displayCost && (
            <span className={`text-sm font-medium ${costOverride?.isFree ? 'text-[#22c55e]' : 'text-white'}`}>
              {displayCost}
            </span>
          )}
          <span className={`text-xs px-2 py-0.5 rounded ${session.fastChargerPresent ? 'bg-[#f59e0b]/20 text-[#f59e0b]' : 'bg-[#3b82f6]/20 text-[#3b82f6]'}`}>
            {session.fastChargerPresent ? 'Supercharger' : 'AC'}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-4 text-sm text-[#9ca3af]">
        <span>{kwh.toFixed(1)} kWh</span>
        <span>{session.durationMin ?? '—'} min</span>
        <span>{session.startBatteryLevel}% → {session.endBatteryLevel}%</span>
        {session.outsideTempAvg != null && <span>{Math.round(session.outsideTempAvg)}°C</span>}
      </div>

      {expanded && (
        <div className="mt-3 pt-3 border-t border-[#2a2a2a] space-y-3">
          <div className="flex gap-1 mb-1">
            <button
              type="button"
              onClick={() => { setInputMode('total'); setPriceInput(costOverride?.totalCost?.toString() ?? ''); }}
              className={`flex-1 py-1.5 rounded-lg text-xs font-medium min-h-[36px] ${inputMode === 'total' ? 'bg-[#e31937] text-white' : 'bg-[#1a1a1a] text-[#9ca3af]'}`}
            >
              Total (€)
            </button>
            <button
              type="button"
              onClick={() => { setInputMode('kwh'); setPriceInput(costOverride?.pricePerKwh?.toString() ?? ''); }}
              className={`flex-1 py-1.5 rounded-lg text-xs font-medium min-h-[36px] ${inputMode === 'kwh' ? 'bg-[#e31937] text-white' : 'bg-[#1a1a1a] text-[#9ca3af]'}`}
            >
              €/kWh
            </button>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="number"
              step={inputMode === 'total' ? '0.01' : '0.0001'}
              placeholder={inputMode === 'total' ? 'Total € (from invoice)' : '€/kWh'}
              value={priceInput}
              onChange={(e) => setPriceInput(e.target.value)}
              className="flex-1 bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-white text-sm focus:border-[#e31937] focus:outline-none min-h-[44px]"
            />
            <button
              onClick={handleSave}
              disabled={saveCost.isPending}
              className="bg-[#e31937] text-white px-4 py-2 rounded-lg text-sm font-medium min-h-[44px] active:bg-[#c0152f]"
            >
              {saveCost.isPending ? '...' : 'Save'}
            </button>
            <button
              onClick={handleFree}
              disabled={saveCost.isPending}
              className="bg-[#22c55e]/20 text-[#22c55e] px-4 py-2 rounded-lg text-sm font-medium min-h-[44px] active:bg-[#22c55e]/30"
            >
              Free
            </button>
          </div>

          {previewText && (
            <div className="text-xs text-[#9ca3af]">{previewText}</div>
          )}

          {session.latitude != null && session.longitude != null && (
            <button
              onClick={() => setShowLocationForm(!showLocationForm)}
              className="text-xs text-[#3b82f6] underline"
            >
              {showLocationForm ? 'Hide' : 'Define this location'}
            </button>
          )}

          {showLocationForm && session.latitude != null && session.longitude != null && (
            <LocationForm
              lat={session.latitude}
              lng={session.longitude}
              defaultName={session.address ?? session.geofenceName ?? ''}
              carId={carId}
              onDone={() => setShowLocationForm(false)}
            />
          )}
        </div>
      )}
    </div>
  );
}

function LocationForm({ lat, lng, defaultName, carId, onDone }: {
  lat: number;
  lng: number;
  defaultName: string;
  carId: number | undefined;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(defaultName);
  const [pricingType, setPricingType] = useState('manual');
  const [peakPrice, setPeakPrice] = useState('');
  const [offPeakPrice, setOffPeakPrice] = useState('');
  const [offPeakStart, setOffPeakStart] = useState('22:00');
  const [offPeakEnd, setOffPeakEnd] = useState('06:00');
  const [monthlyAmount, setMonthlyAmount] = useState('');
  const [radius, setRadius] = useState('200');

  const [existingLocation, setExistingLocation] = useState<ChargingLocation | null>(null);

  useQuery({
    queryKey: ['matchLocation', lat, lng, carId],
    queryFn: () => getMatchingLocation(lat, lng, carId),
    onSuccess: (loc: ChargingLocation | null) => {
      if (loc) {
        setExistingLocation(loc);
        setName(loc.name);
        setPricingType(loc.pricingType);
        if (loc.peakPricePerKwh != null) setPeakPrice(loc.peakPricePerKwh.toString());
        if (loc.offPeakPricePerKwh != null) setOffPeakPrice(loc.offPeakPricePerKwh.toString());
        if (loc.offPeakStart) setOffPeakStart(loc.offPeakStart);
        if (loc.offPeakEnd) setOffPeakEnd(loc.offPeakEnd);
        if (loc.monthlySubscription != null) setMonthlyAmount(loc.monthlySubscription.toString());
        setRadius(loc.radiusMeters.toString());
      }
    },
  } as any);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name,
        latitude: lat,
        longitude: lng,
        radiusMeters: parseInt(radius) || 200,
        pricingType,
        peakPricePerKwh: peakPrice ? parseFloat(peakPrice) : null,
        offPeakPricePerKwh: offPeakPrice ? parseFloat(offPeakPrice) : null,
        offPeakStart: pricingType === 'home' ? offPeakStart : null,
        offPeakEnd: pricingType === 'home' ? offPeakEnd : null,
        monthlySubscription: monthlyAmount ? parseFloat(monthlyAmount) : null,
        carId: carId ?? null,
      };
      const url = existingLocation
        ? `/costs/locations/${existingLocation.id}`
        : '/costs/locations';
      return api(url, {
        method: existingLocation ? 'PUT' : 'POST',
        body: JSON.stringify(body),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chargingLocations'] });
      onDone();
    },
  });

  const inputClass = 'bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-white text-sm focus:border-[#e31937] focus:outline-none min-h-[40px] w-full';

  return (
    <div className="bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg p-4 space-y-3">
      <input className={inputClass} placeholder="Location name" value={name} onChange={(e) => setName(e.target.value)} />

      <div className="flex gap-2">
        {(['manual', 'home', 'subscription'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setPricingType(t)}
            className={`flex-1 py-2 rounded-lg text-xs font-medium min-h-[40px] transition-colors ${
              pricingType === t ? 'bg-[#e31937] text-white' : 'bg-[#1a1a1a] text-[#9ca3af]'
            }`}
          >
            {t === 'manual' ? 'Manual' : t === 'home' ? 'Home (HC/HP)' : 'Subscription'}
          </button>
        ))}
      </div>

      {pricingType === 'home' && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <input className={inputClass} type="number" step="0.0001" placeholder="Peak €/kWh" value={peakPrice} onChange={(e) => setPeakPrice(e.target.value)} />
            <input className={inputClass} type="number" step="0.0001" placeholder="Off-peak €/kWh" value={offPeakPrice} onChange={(e) => setOffPeakPrice(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input className={inputClass} type="time" value={offPeakStart} onChange={(e) => setOffPeakStart(e.target.value)} />
            <input className={inputClass} type="time" value={offPeakEnd} onChange={(e) => setOffPeakEnd(e.target.value)} />
          </div>
        </>
      )}

      {pricingType === 'subscription' && (
        <input className={inputClass} type="number" step="0.01" placeholder="Monthly amount (€)" value={monthlyAmount} onChange={(e) => setMonthlyAmount(e.target.value)} />
      )}

      <input className={inputClass} type="number" placeholder="Radius (m)" value={radius} onChange={(e) => setRadius(e.target.value)} />

      <div className="flex gap-2">
        <button onClick={() => save.mutate()} disabled={save.isPending} className="bg-[#e31937] text-white px-4 py-2 rounded-lg text-sm min-h-[40px] active:bg-[#c0152f]">
          {save.isPending ? 'Saving...' : existingLocation ? 'Update location' : 'Save location'}
        </button>
        <button onClick={onDone} className="bg-[#2a2a2a] text-[#9ca3af] px-4 py-2 rounded-lg text-sm min-h-[40px]">
          Cancel
        </button>
      </div>
    </div>
  );
}
