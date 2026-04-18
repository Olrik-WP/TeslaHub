import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, Cell } from 'recharts';
import { useTranslation } from 'react-i18next';
import { useUnits } from '../hooks/useUnits';
import { utcDate } from '../utils/date';
import { getChargingSessions, getChargingSummary, getCostOverrides, getSuggestedPrice, getMatchingLocation, getSettings } from '../api/queries';
import { api } from '../api/client';
import type { ChargingSession, CostOverride, ChargingLocation } from '../api/queries';
import StatCard from '../components/StatCard';
import { COLORS, LIMITS, STALE_TIME } from '../constants/theme';

interface Props {
  carId: number | undefined;
}

type PeriodKey = '7d' | '30d' | '90d' | 'all';
type TypeFilter = 'all' | 'AC' | 'DC';

const PERIOD_OPTIONS: { key: PeriodKey; labelKey: string; days?: number }[] = [
  { key: '7d', labelKey: 'charging.7days', days: 7 },
  { key: '30d', labelKey: 'charging.30days', days: 30 },
  { key: '90d', labelKey: 'charging.90days', days: 90 },
  { key: 'all', labelKey: 'charging.all' },
];

export default function Charging({ carId }: Props) {
  const [period, setPeriod] = useState<PeriodKey>('90d');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const u = useUnits();
  const { t } = useTranslation();

  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: getSettings });
  const costSource = settings?.costSource ?? 'teslahub';

  const selectedPeriod = PERIOD_OPTIONS.find((p) => p.key === period)!;
  const chargeTypeParam = typeFilter === 'all' ? undefined : typeFilter;

  const { data: sessions, isLoading } = useQuery({
    queryKey: ['charging', carId, LIMITS.chargingSessionsPage, 0, chargeTypeParam, selectedPeriod.days],
    queryFn: () => getChargingSessions(carId!, LIMITS.chargingSessionsPage, 0, chargeTypeParam, selectedPeriod.days),
    enabled: !!carId,
    staleTime: STALE_TIME.live,
  });

  const { data: summary } = useQuery({
    queryKey: ['chargingSummary', carId, selectedPeriod.days],
    queryFn: () => getChargingSummary(carId!, selectedPeriod.days),
    enabled: !!carId,
  });

  const { data: overrides } = useQuery({
    queryKey: ['costOverrides', carId],
    queryFn: () => getCostOverrides(carId!),
    enabled: !!carId && costSource === 'teslahub',
  });

  if (isLoading) {
    return <div className="flex items-center justify-center h-[60vh] text-[#9ca3af]">{t('app.loading')}</div>;
  }

  const overrideMap = new Map(overrides?.map((o) => [o.chargingProcessId, o]));
  const activeSession = sessions?.find((s) => !s.endDate);
  const filteredSessions = sessions?.filter((s) => s.endDate) ?? [];

  const chartData = filteredSessions
    .slice(0, 20)
    .reverse()
    .map((s) => ({
      date: utcDate(s.startDate).toLocaleDateString(undefined, { day: '2-digit', month: 'short' }),
      kwh: s.chargeEnergyAdded ?? 0,
      type: s.chargeType ?? (s.fastChargerPresent ? 'DC' : 'AC'),
    }));

  return (
    <div className="p-4 space-y-4">
      {/* Filters */}
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
        <div className="w-px bg-[#2a2a2a] mx-1" />
        {(['all', 'AC', 'DC'] as const).map((tf) => (
          <button
            key={tf}
            onClick={() => setTypeFilter(tf)}
            className={`px-3 py-2 rounded-lg text-sm font-medium min-h-[40px] transition-colors ${
              typeFilter === tf ? 'bg-[#e31937] text-white' : 'bg-[#1a1a1a] text-[#9ca3af]'
            }`}
          >
            {tf === 'all' ? t('charging.all') : tf}
          </button>
        ))}
      </div>

      {/* Summary */}
      {summary && summary.chargeCount > 0 && (() => {
        const totalCost = costSource === 'teslamate'
          ? summary.totalCost
          : filteredSessions.reduce((sum, s) => sum + (overrideMap.get(s.id)?.totalCost ?? 0), 0);
        return (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label={t('charging.energyAdded')} value={Math.round(summary.totalEnergyAdded)} unit="kWh" color="#eab308" />
            <StatCard label={t('charging.totalCost')} value={totalCost > 0 ? totalCost.toFixed(2) : '—'} unit={totalCost > 0 ? u.currencySymbol : undefined} />
            <StatCard label={t('charging.avgDuration')} value={Math.round(summary.avgDurationMin)} unit="min" />
            <StatCard label={t('charging.efficiency')} value={`${(summary.avgEfficiency * 100).toFixed(0)}%`} color="#22c55e" />
          </div>
        );
      })()}

      {/* Charging now */}
      {activeSession && (
        <div className="bg-[#141414] border border-[#3b82f6]/30 rounded-xl p-3 sm:p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[#3b82f6] text-xl">⚡</span>
            <span className="font-medium">{t('charging.chargingNow')}</span>
            {activeSession.address && (
              <span className="text-[#9ca3af] text-sm ml-auto truncate max-w-[50%]">{activeSession.address.split(',')[0]}</span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <div>
              <span className="text-[#9ca3af]">{t('charging.addedLabel')} </span>
              <span className="font-medium">{activeSession.chargeEnergyAdded?.toFixed(1) ?? '—'} kWh</span>
            </div>
            <div>
              <span className="text-[#9ca3af]">{t('charging.batteryLabel')} </span>
              <span className="font-medium">{activeSession.startBatteryLevel}% → ?%</span>
            </div>
          </div>
        </div>
      )}

      {/* Chart */}
      {chartData.length > 0 && (
        <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl p-3 sm:p-4">
          <div className="text-xs text-[#9ca3af] uppercase tracking-wider mb-3">{t('charging.energyAddedKwh')}</div>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={chartData}>
              <XAxis dataKey="date" tick={{ fill: '#9ca3af', fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#9ca3af', fontSize: 10 }} axisLine={false} tickLine={false} width={30} />
              <Tooltip contentStyle={{ background: COLORS.surfaceMuted, border: `1px solid ${COLORS.border}`, borderRadius: 8, color: '#fff', fontSize: 12 }} />
              <Bar dataKey="kwh" radius={[4, 4, 0, 0]}>
                {chartData.map((entry, i) => (
                  <Cell key={i} fill={entry.type === 'DC' ? COLORS.dc : COLORS.info} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div className="flex items-center gap-4 mt-2 text-[10px] text-[#9ca3af]">
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-[#3b82f6] inline-block" /> {t('charging.ac')}</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-[#f59e0b] inline-block" /> {t('charging.dcSupercharger')}</span>
          </div>
        </div>
      )}

      {/* Sessions list */}
      <div className="space-y-2">
        {filteredSessions.map((session) => (
          <SessionCard
            key={session.id}
            session={session}
            override={overrideMap.get(session.id)}
            carId={carId}
            costSource={costSource}
          />
        ))}
        {filteredSessions.length === 0 && (
          <div className="text-center text-[#9ca3af] py-8">{t('charging.noSessions')}</div>
        )}
      </div>
    </div>
  );
}

function SessionCard({ session, override: costOverride, carId, costSource }: {
  session: ChargingSession;
  override: CostOverride | undefined;
  carId: number | undefined;
  costSource: string;
}) {
  const navigate = useNavigate();
  const isTeslaHub = costSource !== 'teslamate';
  const queryClient = useQueryClient();
  const u = useUnits();
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [inputMode, setInputMode] = useState<'total' | 'kwh'>('total');
  const [priceInput, setPriceInput] = useState(costOverride?.totalCost?.toString() ?? '');
  const [showLocationForm, setShowLocationForm] = useState(false);

  const { data: suggestedPriceData } = useQuery({
    queryKey: ['suggestPrice', session.latitude, session.longitude, carId],
    queryFn: () => getSuggestedPrice(session.latitude!, session.longitude!, carId!),
    enabled: expanded && !costOverride && session.latitude != null && session.longitude != null && !!carId,
  });

  useEffect(() => {
    if (suggestedPriceData?.suggestedPrice != null && !priceInput) {
      setInputMode('kwh');
      setPriceInput(suggestedPriceData.suggestedPrice.toString());
    }
  }, [suggestedPriceData, priceInput]);

  const kwh = session.chargeEnergyAdded ?? session.chargeEnergyUsed ?? 0;
  const chargeType = session.chargeType ?? (session.fastChargerPresent ? 'DC' : 'AC');

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
          latitude: session.latitude,
          longitude: session.longitude,
          energyKwh: kwh > 0 ? kwh : null,
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['costOverrides'] });
      queryClient.invalidateQueries({ queryKey: ['costSummary'] });
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

  const isSubscription = costOverride?.location?.pricingType === 'subscription';

  const displayCostRaw = isTeslaHub
    ? (costOverride
        ? isSubscription ? 'Subscription'
          : (costOverride.isFree || costOverride.totalCost === 0) ? 'Free'
          : `${costOverride.totalCost.toFixed(2)} ${u.currencySymbol}`
        : null)
    : (session.cost != null && session.cost > 0
        ? `${session.cost.toFixed(2)} ${u.currencySymbol}`
        : session.cost === 0 ? 'Free' : null);

  const displayCost = displayCostRaw === 'Free' ? t('charging.free')
    : displayCostRaw === 'Subscription' ? t('charging.subscription')
    : displayCostRaw;

  const previewText = (() => {
    const value = parseFloat(priceInput);
    if (isNaN(value)) return null;
    if (inputMode === 'total') {
      const effectiveKwh = kwh > 0 ? (value / kwh).toFixed(4) : '—';
      return t('charging.previewTotal', {
        total: value.toFixed(2),
        perKwh: effectiveKwh,
        currency: u.currencySymbol,
      });
    }
    return t('charging.previewPerKwh', {
      total: (value * kwh).toFixed(2),
      kwh: kwh.toFixed(1),
      currency: u.currencySymbol,
    });
  })();

  const effPct = session.efficiency != null ? Math.round(session.efficiency * 100) : null;
  const effColor = effPct != null ? (effPct >= 95 ? COLORS.success : effPct >= 85 ? COLORS.warning : COLORS.danger) : COLORS.textMuted;

  return (
    <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl p-3 sm:p-4">
      {/* Header row */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="text-sm font-medium truncate">
            {utcDate(session.startDate).toLocaleDateString()}
            {' · '}
            {costOverride?.location?.name ?? session.geofenceName ?? session.address?.split(',')[0] ?? t('charging.unknown')}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {displayCost && (
            <span className={`text-sm font-medium ${
              displayCostRaw === 'Free' ? 'text-[#22c55e]'
              : displayCostRaw === 'Subscription' ? 'text-[#3b82f6]'
              : 'text-white'
            }`}>
              {displayCost}
            </span>
          )}
          <span className={`text-xs px-2 py-0.5 rounded ${chargeType === 'DC' ? 'bg-[#f59e0b]/20 text-[#f59e0b]' : 'bg-[#3b82f6]/20 text-[#3b82f6]'}`}>
            {chargeType}
          </span>
          {chargeType === 'DC' && (
            <button
              onClick={() => navigate(`/charging-stats?session=${session.id}`)}
              className="text-[10px] px-2 py-0.5 rounded bg-[#f59e0b]/10 text-[#f59e0b] border border-[#f59e0b]/30 hover:bg-[#f59e0b]/20 transition-colors"
            >
              {t('charging.curve')}
            </button>
          )}
          {isTeslaHub && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="w-9 h-9 flex items-center justify-center rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] text-[#9ca3af] active:bg-[#2a2a2a] transition-colors flex-shrink-0"
              aria-label={expanded ? t('charging.collapse') : t('charging.expand')}
            >
              <span className={`text-sm transition-transform duration-200 inline-block ${expanded ? 'rotate-180' : ''}`}>▼</span>
            </button>
          )}
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-x-3 gap-y-1 text-xs text-[#9ca3af]">
        <div>
          <span className="text-white font-medium">{kwh.toFixed(1)}</span> kWh
        </div>
        <div>
          <span className="text-white font-medium">{session.durationMin ?? '—'}</span> min
        </div>
        <div>
          {session.startBatteryLevel}% → {session.endBatteryLevel}%
        </div>
        {effPct != null && (
          <div className="flex items-center gap-1">
            <span className="font-medium" style={{ color: effColor }}>{effPct}%</span>
            <span>{t('charging.eff')}</span>
          </div>
        )}
        {session.avgPowerKw != null && (
          <div>
            <span className="text-white font-medium">{session.avgPowerKw.toFixed(1)}</span> kW
          </div>
        )}
        {session.rangeAddedKm != null && session.rangeAddedKm > 0 && (
          <div>
            +<span className="text-white font-medium">{Math.round(u.convertDistance(session.rangeAddedKm)!)}</span> {u.distanceUnit}
          </div>
        )}
        {session.distanceSinceLastCharge != null && session.distanceSinceLastCharge > 0 && (
          <div title={t('charging.kmSinceLastCharge')}>
            <span className="text-white font-medium">{Math.round(u.convertDistance(session.distanceSinceLastCharge)!)}</span> {u.distanceUnit}
          </div>
        )}
        {session.maxCurrent != null && session.maxVoltage != null && (
          <div>
            <span className="text-white font-medium">{session.maxCurrent}</span>A · <span className="text-white font-medium">{session.maxVoltage}</span>V
          </div>
        )}
        {session.connChargeCable != null && (
          <div>
            <span className="text-white font-medium">{session.connChargeCable}</span>
          </div>
        )}
      </div>

      {/* Temp row */}
      {session.outsideTempAvg != null && (
        <div className="text-xs text-[#9ca3af] mt-1">
          {u.fmtTemp(session.outsideTempAvg)}{u.tempUnit}
          {isTeslaHub
            ? costOverride?.pricePerKwh != null && ` · ${costOverride.pricePerKwh.toFixed(2)} ${u.currencySymbol}/kWh`
            : session.costPerKwh != null && ` · ${session.costPerKwh.toFixed(2)} ${u.currencySymbol}/kWh`}
          {session.chargeRateKmPerHour != null && session.chargeRateKmPerHour > 0 && ` · ${Math.round(u.convertDistance(session.chargeRateKmPerHour)!)} ${u.distanceUnit}/h`}
        </div>
      )}

      {/* Expanded: cost input + location form (TeslaHub mode only) */}
      {isTeslaHub && expanded && (
        <div className="mt-3 pt-3 border-t border-[#2a2a2a] space-y-3">
          <div className="flex gap-1 mb-1">
            <button
              type="button"
              onClick={() => { setInputMode('total'); setPriceInput(costOverride?.totalCost?.toString() ?? ''); }}
              className={`flex-1 py-1.5 rounded-lg text-xs font-medium min-h-[36px] ${inputMode === 'total' ? 'bg-[#e31937] text-white' : 'bg-[#1a1a1a] text-[#9ca3af]'}`}
            >
              {t('charging.total')} ({u.currencySymbol})
            </button>
            <button
              type="button"
              onClick={() => { setInputMode('kwh'); setPriceInput(costOverride?.pricePerKwh?.toString() ?? ''); }}
              className={`flex-1 py-1.5 rounded-lg text-xs font-medium min-h-[36px] ${inputMode === 'kwh' ? 'bg-[#e31937] text-white' : 'bg-[#1a1a1a] text-[#9ca3af]'}`}
            >
              {u.currencySymbol}/kWh
            </button>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="number"
              step={inputMode === 'total' ? '0.01' : '0.0001'}
              placeholder={inputMode === 'total' ? `Total ${u.currencySymbol} (from invoice)` : `${u.currencySymbol}/kWh`}
              value={priceInput}
              onChange={(e) => setPriceInput(e.target.value)}
              className="flex-1 bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-white text-sm focus:border-[#e31937] focus:outline-none min-h-[44px]"
            />
            <button
              onClick={handleSave}
              disabled={saveCost.isPending}
              className="bg-[#e31937] text-white px-4 py-2 rounded-lg text-sm font-medium min-h-[44px] active:bg-[#c0152f]"
            >
              {saveCost.isPending ? '...' : t('charging.save')}
            </button>
            <button
              onClick={handleFree}
              disabled={saveCost.isPending}
              className="bg-[#22c55e]/20 text-[#22c55e] px-4 py-2 rounded-lg text-sm font-medium min-h-[44px] active:bg-[#22c55e]/30"
            >
              {t('charging.free')}
            </button>
          </div>

          {previewText && (
            <div className="text-xs text-[#9ca3af]">{previewText}</div>
          )}

          {session.latitude != null && session.longitude != null && (
            <button
              onClick={() => setShowLocationForm(!showLocationForm)}
              className="bg-[#3b82f6] text-white px-4 py-2 rounded-lg text-sm font-medium min-h-[44px] active:bg-[#2563eb] transition-colors w-full"
            >
              {showLocationForm ? t('charging.hideLocation') : t('charging.defineLocation')}
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
  const u = useUnits();
  const { t } = useTranslation();
  const [name, setName] = useState(defaultName);
  const [pricingType, setPricingType] = useState('manual');
  const [peakPrice, setPeakPrice] = useState('');
  const [offPeakPrice, setOffPeakPrice] = useState('');
  const [offPeakStart, setOffPeakStart] = useState('22:00');
  const [offPeakEnd, setOffPeakEnd] = useState('06:00');
  const [monthlyAmount, setMonthlyAmount] = useState('');
  const [radius, setRadius] = useState('200');
  const [allVehicles, setAllVehicles] = useState(false);

  const [existingLocation, setExistingLocation] = useState<ChargingLocation | null>(null);

  const { data: matchedLocation } = useQuery({
    queryKey: ['matchLocation', lat, lng, carId],
    queryFn: () => getMatchingLocation(lat, lng, carId),
  });

  useEffect(() => {
    if (!matchedLocation) return;
    setExistingLocation(matchedLocation);
    setName(matchedLocation.name);
    setPricingType(matchedLocation.pricingType);
    if (matchedLocation.peakPricePerKwh != null) setPeakPrice(matchedLocation.peakPricePerKwh.toString());
    if (matchedLocation.offPeakPricePerKwh != null) setOffPeakPrice(matchedLocation.offPeakPricePerKwh.toString());
    if (matchedLocation.offPeakStart) setOffPeakStart(matchedLocation.offPeakStart);
    if (matchedLocation.offPeakEnd) setOffPeakEnd(matchedLocation.offPeakEnd);
    if (matchedLocation.monthlySubscription != null) setMonthlyAmount(matchedLocation.monthlySubscription.toString());
    setRadius(matchedLocation.radiusMeters.toString());
    setAllVehicles(matchedLocation.carId == null);
  }, [matchedLocation]);

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
        carId: allVehicles ? null : (carId ?? null),
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
      queryClient.invalidateQueries({ queryKey: ['costOverrides'] });
      queryClient.invalidateQueries({ queryKey: ['charging'] });
      queryClient.invalidateQueries({ queryKey: ['chargingSummary'] });
      onDone();
    },
  });

  const inputClass = 'bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-white text-sm focus:border-[#e31937] focus:outline-none min-h-[40px] w-full';

  return (
    <div className="bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg p-3 sm:p-4 space-y-3">
      <input className={inputClass} placeholder={t('charging.locationName')} value={name} onChange={(e) => setName(e.target.value)} />

      <div className="flex gap-2">
        {(['manual', 'home', 'subscription'] as const).map((pt) => (
          <button
            key={pt}
            type="button"
            onClick={() => setPricingType(pt)}
            className={`flex-1 py-2 rounded-lg text-xs font-medium min-h-[40px] transition-colors ${
              pricingType === pt ? 'bg-[#e31937] text-white' : 'bg-[#1a1a1a] text-[#9ca3af]'
            }`}
          >
            {pt === 'manual' ? t('charging.manual') : pt === 'home' ? t('charging.homeHcHp') : t('charging.subscription')}
          </button>
        ))}
      </div>

      {pricingType === 'home' && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <input className={inputClass} type="number" step="0.0001" placeholder={`${t('charging.peak')} ${u.currencySymbol}/kWh`} value={peakPrice} onChange={(e) => setPeakPrice(e.target.value)} />
            <input className={inputClass} type="number" step="0.0001" placeholder={`${t('charging.offPeak')} ${u.currencySymbol}/kWh`} value={offPeakPrice} onChange={(e) => setOffPeakPrice(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input className={inputClass} type="time" value={offPeakStart} onChange={(e) => setOffPeakStart(e.target.value)} />
            <input className={inputClass} type="time" value={offPeakEnd} onChange={(e) => setOffPeakEnd(e.target.value)} />
          </div>
        </>
      )}

      {pricingType === 'subscription' && (
        <input className={inputClass} type="number" step="0.01" placeholder={`${t('charging.monthlyAmount')} (${u.currencySymbol})`} value={monthlyAmount} onChange={(e) => setMonthlyAmount(e.target.value)} />
      )}

      <input className={inputClass} type="number" placeholder={t('charging.radius')} value={radius} onChange={(e) => setRadius(e.target.value)} />

      <label className="flex items-center gap-2 text-sm text-[#9ca3af] cursor-pointer min-h-[44px]">
        <input
          type="checkbox"
          checked={allVehicles}
          onChange={(e) => setAllVehicles(e.target.checked)}
          className="w-4 h-4 accent-[#3b82f6]"
        />
        {t('charging.allVehicles')}
      </label>

      <div className="flex gap-2">
        <button onClick={() => save.mutate()} disabled={save.isPending} className="bg-[#e31937] text-white px-4 py-2 rounded-lg text-sm min-h-[40px] active:bg-[#c0152f]">
          {save.isPending ? t('charging.savingLocation') : existingLocation ? t('charging.updateLocation') : t('charging.saveLocation')}
        </button>
        <button onClick={onDone} className="bg-[#2a2a2a] text-[#9ca3af] px-4 py-2 rounded-lg text-sm min-h-[40px]">
          {t('charging.cancel')}
        </button>
      </div>
    </div>
  );
}
