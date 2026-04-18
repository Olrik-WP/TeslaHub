import { useRef, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Map, Marker } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useVehicleStatus } from '../hooks/useVehicle';
import { useLiveStream } from '../hooks/useLiveStream';
import { useChargingSessions } from '../hooks/useCharging';
import { useDrives } from '../hooks/useDrives';
import { useUnits } from '../hooks/useUnits';
import { useMapStyle } from '../hooks/useMapStyle';
import BatteryGauge from '../components/BatteryGauge';
import StatCard from '../components/StatCard';
import VehicleTopView from '../components/VehicleTopView';
import { getStats, getChargingStats, getDriveStats, getSettings, getCostOverrides, getCostSummary, getTeslaMateCostSummary, getCarConfig } from '../api/queries';
import type { VehicleStatus } from '../api/queries';
import { useTranslation } from 'react-i18next';
import { utcDate } from '../utils/date';
import { computeCostStack } from '../utils/costStack';

interface Props {
  carId: number | undefined;
}

const STICKY_KEY = 'teslahub_sticky_vehicle';
const STICKY_FIELDS: (keyof VehicleStatus)[] = [
  'odometer', 'outsideTemp', 'insideTemp', 'ratedBatteryRangeKm',
  'batteryLevel', 'latitude', 'longitude', 'firmwareVersion',
  'currentCapacityKwh', 'maxCapacityKwh', 'usableBatteryLevel',
  'estBatteryRangeKm',
];

function loadSticky(): Partial<VehicleStatus> {
  try {
    const raw = localStorage.getItem(STICKY_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function useStickyVehicle(vehicle: VehicleStatus | undefined) {
  const lastKnown = useRef<Partial<VehicleStatus>>(loadSticky());

  if (vehicle) {
    let changed = false;
    for (const key of STICKY_FIELDS) {
      if (vehicle[key] != null) {
        if ((lastKnown.current as any)[key] !== vehicle[key]) {
          (lastKnown.current as any)[key] = vehicle[key];
          changed = true;
        }
      }
    }
    if (changed) {
      const toSave: Record<string, unknown> = {};
      for (const key of STICKY_FIELDS) {
        if (lastKnown.current[key] != null) toSave[key] = lastKnown.current[key];
      }
      localStorage.setItem(STICKY_KEY, JSON.stringify(toSave));
    }
  }

  if (!vehicle) return undefined;

  const result = { ...vehicle };
  for (const key of STICKY_FIELDS) {
    if (result[key] == null && lastKnown.current[key] != null) {
      (result as any)[key] = lastKnown.current[key];
    }
  }
  return result;
}

const DOT_STYLE: React.CSSProperties = {
  width: 16,
  height: 16,
  borderRadius: '50%',
  background: '#e31937',
  border: '3px solid #fff',
  boxShadow: '0 0 6px rgba(0,0,0,.4)',
};

export default function Home({ carId }: Props) {
  const navigate = useNavigate();
  const { data: rawVehicle } = useVehicleStatus(carId);
  const { data: live, connected: liveConnected } = useLiveStream(carId);
  const vehicle = useStickyVehicle(rawVehicle);
  const liveActive = liveConnected && live?.latitude != null && live?.longitude != null;
  const { data: charges } = useChargingSessions(carId, 10);
  const { data: drives } = useDrives(carId, 5);
  const { data: stats } = useQuery({
    queryKey: ['home-stats', carId],
    queryFn: () => getStats(carId!),
    enabled: !!carId,
    staleTime: 5 * 60_000,
  });
  const { data: chargingStats } = useQuery({
    queryKey: ['charging-stats', carId],
    queryFn: () => getChargingStats(carId!),
    enabled: !!carId,
    staleTime: 5 * 60_000,
  });
  const { data: driveStats } = useQuery({
    queryKey: ['drive-stats', carId],
    queryFn: () => getDriveStats(carId!),
    enabled: !!carId,
    staleTime: 5 * 60_000,
  });
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: getSettings, staleTime: 5 * 60_000 });
  const mapStyle = useMapStyle();
  const costSource = settings?.costSource ?? 'teslahub';
  const { data: overrides } = useQuery({
    queryKey: ['costOverrides', carId],
    queryFn: () => getCostOverrides(carId!),
    enabled: !!carId && costSource === 'teslahub',
    staleTime: 5 * 60_000,
  });
  const now = new Date();
  const curYear = now.getFullYear();
  const curMonth = now.getMonth() + 1;
  const { data: monthlyCost } = useQuery({
    queryKey: ['monthlyCost', carId, costSource, curYear, curMonth],
    queryFn: () =>
      costSource === 'teslahub'
        ? getCostSummary(carId!, 'month', curYear, curMonth)
        : getTeslaMateCostSummary(carId!, 'month', curYear, curMonth),
    enabled: !!carId,
    staleTime: 5 * 60_000,
  });
  const { data: carConfig } = useQuery({
    queryKey: ['carConfig', carId],
    queryFn: () => getCarConfig(carId!),
    enabled: !!carId,
    staleTime: 5 * 60_000,
  });
  const isTeslaHub = costSource !== 'teslamate';
  const tripCostQueryFn = isTeslaHub ? getCostSummary : getTeslaMateCostSummary;
  const { data: tripCostSummary } = useQuery({
    queryKey: ['tripCost', carId, costSource],
    queryFn: () => tripCostQueryFn(carId!),
    enabled: !!carId,
    staleTime: 5 * 60_000,
  });
  const tripCostPerKm = (tripCostSummary?.costPerKm ?? 0) > 0 ? tripCostSummary!.costPerKm : null;
  const monthlySavings = (() => {
    if (!monthlyCost || !carConfig?.gasPricePerLiter || !carConfig?.gasConsumptionLPer100Km) return null;
    const dist = monthlyCost.totalDistanceKm;
    if (dist <= 0) return null;
    const gasEquiv = dist * (carConfig.gasConsumptionLPer100Km / 100) * carConfig.gasPricePerLiter;
    return gasEquiv - monthlyCost.totalCost;
  })();
  const u = useUnits();
  const { t, i18n } = useTranslation();
  const [imgError, setImgError] = useState(false);
  const [address, setAddress] = useState<string | null>(null);
  const [showCostInfo, setShowCostInfo] = useState(false);

  const activeDrive = drives?.find((d) => d.endDate == null) ?? null;
  const lastCompletedDrive = drives?.find((d) => d.endDate != null) ?? null;
  const isDrivingLive = live?.state === 'driving' || (live?.shiftState != null && live.shiftState !== 'P');
  const tripInProgress = isDrivingLive || activeDrive != null;
  const tripDisplay = tripInProgress ? activeDrive : lastCompletedDrive;
  const lastCharge = charges?.[0];
  const isCharging = lastCharge && !lastCharge.endDate;
  const lastCompletedCharge = charges?.find((s) => s.endDate);
  const imgSrc = carId ? `/api/vehicle/${carId}/image` : null;

  const kmSinceCharge = vehicle?.kmSinceLastCharge ?? 0;

  const costStack = computeCostStack(
    charges,
    vehicle?.batteryLevel,
    costSource,
    overrides,
    kmSinceCharge,
    (km) => u.convertDistance(km),
  );

  const isLastChargeSubscription = costStack?.isSubscription ?? false;
  const lastChargeCost = costStack ? costStack.totalCostAvailable : null;
  const costConsumed = costStack && costStack.totalCostConsumed > 0 ? costStack.totalCostConsumed : null;
  const costPerKm = costStack?.costPerKm ?? null;

  const tempColor = (t: number | null | undefined) =>
    t == null ? undefined : t <= 0 ? '#3b82f6' : t < 10 ? '#60a5fa' : t < 20 ? '#9ca3af' : t < 30 ? '#f97316' : '#ef4444';

  const currentCapacity = vehicle?.currentCapacityKwh ?? null;
  const maxCapacity = vehicle?.maxCapacityKwh ?? null;

  const storedEnergy =
    currentCapacity != null && vehicle?.usableBatteryLevel != null
      ? vehicle.usableBatteryLevel * currentCapacity / 100
      : currentCapacity != null && vehicle?.batteryLevel != null
        ? vehicle.batteryLevel * currentCapacity / 100
        : null;

  const degradation =
    currentCapacity != null && maxCapacity != null && maxCapacity > 0
      ? Math.max(0, 100 - (currentCapacity * 100 / maxCapacity))
      : null;

  const degradationColor =
    degradation == null ? undefined
    : degradation < 5 ? '#22c55e'
    : degradation < 15 ? '#eab308'
    : '#ef4444';

  const lat = live?.latitude ?? vehicle?.latitude;
  const lng = live?.longitude ?? vehicle?.longitude;
  const lang = i18n.language;
  useEffect(() => {
    if (lat == null || lng == null) return;
    const controller = new AbortController();
    fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=18`,
      { signal: controller.signal, headers: { 'Accept-Language': lang } }
    )
      .then(r => r.json())
      .then(d => {
        if (d.display_name) {
          setAddress(d.display_name.split(',').slice(0, 3).join(',').trim());
        }
      })
      .catch(() => {});
    return () => controller.abort();
  }, [lat, lng, lang]);

  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    if (!tripInProgress) return;
    const id = setInterval(() => setNowTick(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [tripInProgress]);

  if (!vehicle) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="text-[#9ca3af] text-lg">{t('home.loadingVehicle')}</div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      {/* Hero: Vehicle image with drive stats */}
      <div className="bg-[#141414] rounded-xl overflow-hidden">
        {/* Top row: drive averages */}
        {driveStats && driveStats.driveCount > 0 && (
          <div className="grid grid-cols-3 border-b border-[#2a2a2a]">
            <div className="px-3 py-2 text-center">
              <div className="text-xs text-[#9ca3af] uppercase tracking-wider">{t('home.medianDist')}</div>
              <div className="text-base font-bold tabular-nums text-[#e31937]">{driveStats.medianDistanceKm != null ? u.fmtDist(driveStats.medianDistanceKm) : '—'} <span className="text-[11px] font-normal text-[#9ca3af]">{u.distanceUnit}</span></div>
            </div>
            <div className="px-3 py-2 text-center border-x border-[#2a2a2a]">
              <div className="text-xs text-[#9ca3af] uppercase tracking-wider">{t('home.avgDistDay')}</div>
              <div className="text-base font-bold tabular-nums text-[#e31937]">{u.fmtDist(driveStats.totalDistanceKm / driveStats.totalDays)} <span className="text-[11px] font-normal text-[#9ca3af]">{u.distanceUnit}</span></div>
            </div>
            <div className="px-3 py-2 text-center">
              <div className="text-xs text-[#9ca3af] uppercase tracking-wider">{t('home.avgKwhDay')}</div>
              <div className="text-base font-bold tabular-nums text-[#e31937]">{(driveStats.totalNetEnergyKwh / driveStats.totalDays).toFixed(1)} <span className="text-[11px] font-normal text-[#9ca3af]">kWh</span></div>
            </div>
          </div>
        )}

        {/* Mobile: vehicle info + max speed + last charge as inline row */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-[#2a2a2a] sm:hidden">
          <div>
            <div className="text-sm font-bold">{vehicle.marketingName || vehicle.model || vehicle.name}</div>
            <div className="text-[10px] text-[#9ca3af]">
              {[vehicle.exteriorColor, vehicle.vin].filter(Boolean).join(' · ')}
            </div>
          </div>
          <div className="flex items-center gap-4">
            {lastCompletedCharge && isLastChargeSubscription && (
              <div className="text-right cursor-pointer" onClick={() => navigate('/charging')}>
                <div className="text-[10px] text-[#9ca3af] uppercase tracking-wider">{t('home.lastCharge')}</div>
                <div className="text-base font-bold tabular-nums text-[#3b82f6]">{t('home.subscription')}</div>
                {kmSinceCharge >= 1 && (
                  <div className="text-[10px] text-[#9ca3af]">
                    {Math.round(u.convertDistance(kmSinceCharge)!)} {u.distanceUnit} {t('home.sinceCharge')}
                  </div>
                )}
              </div>
            )}
            {lastCompletedCharge && !isLastChargeSubscription && lastChargeCost != null && lastChargeCost > 0 && (
              <div className="text-right">
                <div className="text-[10px] text-[#9ca3af] uppercase tracking-wider flex items-center justify-end gap-1">
                  <span className="cursor-pointer" onClick={() => navigate('/charging')}>{t('home.lastCharge')}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); setShowCostInfo(!showCostInfo); }}
                    className="w-3.5 h-3.5 rounded-full border border-[#9ca3af]/50 text-[8px] text-[#9ca3af] flex items-center justify-center"
                  >i</button>
                </div>
                <div className="text-base font-bold tabular-nums text-[#e31937] cursor-pointer" onClick={() => navigate('/charging')}>
                  {costConsumed != null ? `${costConsumed.toFixed(2)} / ` : ''}{lastChargeCost.toFixed(2)} {u.currencySymbol}
                </div>
                {kmSinceCharge >= 1 && (
                  <div className="text-[10px] text-[#9ca3af]">
                    {Math.round(u.convertDistance(kmSinceCharge)!)} {u.distanceUnit} {t('home.sinceCharge')}
                    {costPerKm != null && ` · ${costPerKm.toFixed(2)} ${u.currencySymbol}/${u.distanceUnit}`}
                  </div>
                )}
              </div>
            )}
            {driveStats && driveStats.maxSpeedKmh != null && (
              <div className="text-right">
                <div className="text-[10px] text-[#9ca3af] uppercase tracking-wider">{t('home.maxSpeed')}</div>
                <div className="text-base font-bold tabular-nums text-[#e31937]">{Math.round(u.convertDistance(driveStats.maxSpeedKmh)!)} <span className="text-[10px] font-normal text-[#9ca3af]">{u.distanceUnit === 'mi' ? 'mph' : 'km/h'}</span></div>
              </div>
            )}
          </div>
        </div>

        {/* Middle row: Car Image + overlays (overlays visible on sm+ only) */}
        <div className="relative flex items-center justify-center h-[180px] sm:h-[220px]">
          <div className="hidden sm:block absolute left-3 top-2 z-10 bg-black/60 rounded-xl px-3 py-2">
            <div className="text-sm font-bold">{vehicle.marketingName || vehicle.model || vehicle.name}</div>
            {vehicle.exteriorColor && <div className="text-[10px] text-[#9ca3af]">{vehicle.exteriorColor}</div>}
            {vehicle.vin && <div className="text-[10px] text-[#9ca3af] tabular-nums">{vehicle.vin}</div>}
          </div>
          {driveStats && driveStats.maxSpeedKmh != null && (
            <div className="hidden sm:block absolute left-3 bottom-2 z-10 bg-black/60 rounded-xl px-3 py-2 text-center">
              <div className="text-[10px] text-[#9ca3af] uppercase tracking-wider">{t('home.maxSpeed')}</div>
              <div className="text-xl font-bold tabular-nums text-[#e31937]">{Math.round(u.convertDistance(driveStats.maxSpeedKmh)!)}</div>
              <div className="text-[10px] text-[#9ca3af]">{u.distanceUnit === 'mi' ? 'mph' : 'km/h'}</div>
            </div>
          )}
          {lastCompletedCharge && isLastChargeSubscription && (
            <div
              className="hidden sm:block absolute right-[230px] bottom-2 z-20 bg-black/60 rounded-xl px-3 py-2 text-center cursor-pointer hover:bg-black/80 transition-colors"
              onClick={() => navigate('/charging')}
            >
              <div className="text-[10px] text-[#9ca3af] uppercase tracking-wider">{t('home.lastCharge')}</div>
              <div className="text-xl font-bold tabular-nums text-[#3b82f6]">{t('home.subscription')}</div>
              {kmSinceCharge >= 1 && (
                <div className="text-[10px] text-[#9ca3af]">
                  {Math.round(u.convertDistance(kmSinceCharge)!)} {u.distanceUnit} {t('home.sinceCharge')}
                </div>
              )}
            </div>
          )}
          {lastCompletedCharge && !isLastChargeSubscription && lastChargeCost != null && lastChargeCost > 0 && (
            <div
              className="hidden sm:block absolute right-[230px] bottom-2 z-20 bg-black/60 rounded-xl px-3 py-2 text-center hover:bg-black/80 transition-colors"
            >
              <div className="text-[10px] text-[#9ca3af] uppercase tracking-wider flex items-center justify-center gap-1">
                <span className="cursor-pointer" onClick={() => navigate('/charging')}>{t('home.lastCharge')}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); setShowCostInfo(!showCostInfo); }}
                  className="w-3.5 h-3.5 rounded-full border border-[#9ca3af]/50 text-[8px] text-[#9ca3af] flex items-center justify-center cursor-pointer"
                >i</button>
              </div>
              <div className="text-xl font-bold tabular-nums text-[#e31937] cursor-pointer" onClick={() => navigate('/charging')}>
                {costConsumed != null ? `${costConsumed.toFixed(2)} / ` : ''}{lastChargeCost.toFixed(2)} {u.currencySymbol}
              </div>
              {kmSinceCharge >= 1 && (
                <div className="text-[10px] text-[#9ca3af]">
                  {Math.round(u.convertDistance(kmSinceCharge)!)} {u.distanceUnit} {t('home.sinceCharge')}
                </div>
              )}
              {costPerKm != null && (
                <div className="text-[10px] text-[#9ca3af]">
                  {costPerKm.toFixed(2)} {u.currencySymbol}/{u.distanceUnit}
                </div>
              )}
            </div>
          )}
          <div className="flex-1 flex items-center justify-center">
            {imgSrc && !imgError ? (
              <img
                src={imgSrc}
                alt={vehicle.name || 'Tesla'}
                className="max-h-[160px] sm:max-h-[200px] w-auto object-contain"
                onError={() => setImgError(true)}
              />
            ) : (
              <span className="text-[#6b7280]">{t('home.vehicleImage')}</span>
            )}
          </div>
          <div className="absolute right-2 bottom-2 z-10 bg-black/60 rounded-xl p-1 w-[100px] h-[100px] sm:w-auto sm:h-auto">
            <BatteryGauge
              level={vehicle.batteryLevel ?? 0}
              rangeKm={u.convertDistance(vehicle.ratedBatteryRangeKm)}
              rangeUnit={u.distanceUnit}
              isCharging={isCharging}
            />
          </div>
        </div>

        {showCostInfo && lastChargeCost != null && (
          <div
            className="mx-3 mb-2 bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-xs text-[#9ca3af] leading-relaxed cursor-pointer"
            onClick={() => setShowCostInfo(false)}
          >
            {t('home.costExplain', { total: `${lastChargeCost.toFixed(2)} ${u.currencySymbol}` })}
          </div>
        )}

        {/* Bottom row: mileage extrapolations + monthly cost */}
        {driveStats && driveStats.driveCount > 0 && (
          <div className="grid grid-cols-4 border-t border-[#2a2a2a]">
            <div className="px-2 py-2 text-center">
              <div className="text-[10px] sm:text-xs text-[#9ca3af] uppercase tracking-wider">{t('home.estMonthly')}</div>
              <div className="text-sm sm:text-base font-bold tabular-nums text-[#e31937]">{Math.round(u.convertDistance(driveStats.totalMileageKm / driveStats.totalDays * (365 / 12))!).toLocaleString()} <span className="text-[10px] sm:text-[11px] font-normal text-[#9ca3af]">{u.distanceUnit}</span></div>
            </div>
            <div className="px-2 py-2 text-center border-x border-[#2a2a2a] cursor-pointer" onClick={() => navigate('/costs')}>
              <div className="text-[10px] sm:text-xs text-[#9ca3af] uppercase tracking-wider">{t('home.costThisMonth')}</div>
              <div className="text-sm sm:text-base font-bold tabular-nums text-[#eab308]">
                {monthlyCost ? `${monthlyCost.totalCost.toFixed(2)}` : '—'} <span className="text-[10px] sm:text-[11px] font-normal text-[#9ca3af]">{u.currencySymbol}</span>
              </div>
            </div>
            <div className="px-2 py-2 text-center border-r border-[#2a2a2a]">
              <div className="text-[10px] sm:text-xs text-[#9ca3af] uppercase tracking-wider">{driveStats.driveCount} {t('home.trips')}</div>
              <div className="text-sm sm:text-base font-bold tabular-nums text-[#e31937]">{Math.round(driveStats.totalDays)} <span className="text-[10px] sm:text-[11px] font-normal text-[#9ca3af]">{t('home.days')}</span></div>
            </div>
            <div className="px-2 py-2 text-center">
              <div className="text-[10px] sm:text-xs text-[#9ca3af] uppercase tracking-wider">{t('home.estAnnual')}</div>
              <div className="text-sm sm:text-base font-bold tabular-nums text-[#e31937]">{Math.round(u.convertDistance(driveStats.totalMileageKm / driveStats.totalDays * 365)!).toLocaleString()} <span className="text-[10px] sm:text-[11px] font-normal text-[#9ca3af]">{u.distanceUnit}</span></div>
            </div>
          </div>
        )}
      </div>

      {/* Charging in progress */}
      {isCharging && lastCharge && (
        <div className="bg-[#141414] border border-[#3b82f6]/30 rounded-xl p-3 sm:p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[#3b82f6] text-lg">⚡</span>
            <span className="font-medium">{t('home.chargingInProgress')}</span>
            {vehicle.chargingState && (
              <span className="ml-auto text-xs text-[#9ca3af] bg-[#2a2a2a] px-2 py-0.5 rounded">{vehicle.chargingState}</span>
            )}
          </div>
          <div className="grid grid-cols-3 gap-3">
            <StatCard
              label={t('home.added')}
              value={vehicle.chargeEnergyAdded?.toFixed(1) ?? lastCharge.chargeEnergyAdded?.toFixed(1) ?? '—'}
              unit="kWh"
              color="#3b82f6"
            />
            <StatCard
              label={t('home.battery')}
              value={`${lastCharge.startBatteryLevel ?? '?'} → ${vehicle.batteryLevel ?? '?'}`}
              unit="%"
              subtitle={vehicle.chargeLimitSoc != null ? `${t('home.targetSoc')}: ${vehicle.chargeLimitSoc}%` : undefined}
              subtitleColor="#3b82f6"
              progress={vehicle.batteryLevel}
            />
            <StatCard
              label={t('home.duration')}
              value={lastCharge.durationMin ?? '—'}
              unit="min"
              subtitle={vehicle.timeToFullCharge != null && vehicle.timeToFullCharge > 0
                ? `${t('home.timeRemaining')}: ${vehicle.timeToFullCharge < 1 ? `${Math.round(vehicle.timeToFullCharge * 60)}min` : `${vehicle.timeToFullCharge.toFixed(1)}h`}`
                : undefined}
              subtitleColor="#22c55e"
            />
            {vehicle.chargerPower != null && vehicle.chargerPower > 0 && (
              <StatCard
                label={t('home.chargerPower')}
                value={vehicle.chargerPower.toFixed(1)}
                unit="kW"
                color="#8b5cf6"
              />
            )}
            {vehicle.chargerVoltage != null && vehicle.chargerActualCurrent != null && (
              <StatCard
                label={t('home.voltageCurrentLabel')}
                value={`${vehicle.chargerVoltage}V · ${vehicle.chargerActualCurrent.toFixed(0)}A`}
              />
            )}
            {vehicle.estBatteryRangeKm != null && (
              <StatCard
                label={t('home.estRange')}
                value={Math.round(u.convertDistance(vehicle.estBatteryRangeKm)!)}
                unit={u.distanceUnit}
                color="#22c55e"
              />
            )}
          </div>
        </div>
      )}

      {/* Vehicle status: TPMS, Body, Climate */}
      <VehicleTopView vehicle={vehicle} />

      {/* Stats grid */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard
          label={t('home.odometer')}
          value={vehicle.odometer ? Math.round(u.convertDistance(vehicle.odometer)!).toLocaleString() : '—'}
          unit={u.distanceUnit}
        />
        <StatCard
          label={t('home.range')}
          value={vehicle.ratedBatteryRangeKm ? (() => {
            const current = Math.round(u.convertDistance(vehicle.ratedBatteryRangeKm)!);
            const bl = vehicle.usableBatteryLevel ?? vehicle.batteryLevel;
            const max = bl && bl > 0 ? Math.round(u.convertDistance(vehicle.ratedBatteryRangeKm * 100 / bl)!) : null;
            return max ? `${current} / ${max}` : current;
          })() : '—'}
          unit={u.distanceUnit}
          color="#22c55e"
          progress={vehicle.batteryLevel}
        />
        <StatCard
          label={t('home.firmware')}
          value={vehicle.firmwareVersion?.split(' ')[0] ?? '—'}
        />
        <StatCard
          label={t('home.extTemp')}
          value={u.fmtTemp(vehicle.outsideTemp)}
          unit={u.tempUnit}
          color={tempColor(vehicle.outsideTemp)}
        />
        <StatCard
          label={t('home.intTemp')}
          value={u.fmtTemp(vehicle.insideTemp)}
          unit={u.tempUnit}
          color={tempColor(vehicle.insideTemp)}
        />
        <StatCard
          label={t('home.state')}
          value={vehicle.state ?? '—'}
        />
        {stats?.avgConsumptionKWhPer100Km != null && stats.avgConsumptionKWhPer100Km > 0 && (
          <StatCard
            label={t('home.avgConsumption')}
            value={u.fmtConsumption(stats.avgConsumptionKWhPer100Km)}
            unit={u.consumptionUnit}
          />
        )}
        {storedEnergy != null && (
          <StatCard
            label={t('home.storedEnergy')}
            value={storedEnergy.toFixed(1)}
            unit="kWh"
            color="#3b82f6"
          />
        )}
        {currentCapacity != null && (
          <StatCard
            label={t('home.usable100')}
            value={currentCapacity.toFixed(1)}
            unit="kWh"
          />
        )}
        {degradation != null && (() => {
          const health = Math.min(100, 100 - degradation);
          const healthColor = health >= 90 ? '#22c55e' : health >= 80 ? '#eab308' : '#ef4444';
          return (
            <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl p-3 sm:p-4 flex flex-col justify-between min-h-[90px] sm:min-h-[100px]">
              <span className="text-[#9ca3af] text-xs uppercase tracking-wider">{t('home.battery')}</span>
              <div className="mt-2 flex items-baseline gap-1 flex-wrap">
                <span className="text-xl sm:text-3xl font-bold tabular-nums" style={{ color: healthColor }}>{health.toFixed(1)}</span>
                <span className="text-[#9ca3af] text-xs sm:text-sm">%</span>
                <span className="text-xs sm:text-sm tabular-nums ml-auto" style={{ color: degradationColor }}>-{degradation.toFixed(1)}%</span>
              </div>
              <div className="mt-2 h-2 rounded-full bg-[#2a2a2a] overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{ width: `${health}%`, backgroundColor: healthColor }}
                />
              </div>
            </div>
          );
        })()}
        {chargingStats && chargingStats.chargeCount > 0 && (
          <StatCard
            label={t('home.sessionsFull')}
            value={`${chargingStats.chargeCount} / ${maxCapacity && maxCapacity > 0 ? Math.floor(chargingStats.totalEnergyAdded / maxCapacity) : '—'}`}
          />
        )}
        {chargingStats && chargingStats.chargeCount > 0 && (
          <StatCard
            label={t('home.totalEnergyAdded')}
            value={`${Math.round(chargingStats.totalEnergyAdded)} kWh`}
            color="#eab308"
            subtitle={`${t('home.overallEfficiency')} ${(chargingStats.chargingEfficiency * 100).toFixed(1)}%`}
            subtitleColor="#22c55e"
          />
        )}
        {monthlySavings != null && (
          <StatCard
            label={carConfig?.gasVehicleName
              ? t('home.savingsVs', { name: carConfig.gasVehicleName })
              : t('home.savingsThisMonth')}
            value={Math.abs(monthlySavings).toFixed(2)}
            unit={u.currencySymbol}
            color={monthlySavings >= 0 ? '#22c55e' : '#ef4444'}
          />
        )}
      </div>

      {/* Map + Last trip */}
      <div className="flex flex-col sm:flex-row gap-3" style={{ minHeight: 200 }}>
        {lat != null && lng != null && (
          <div
            className="flex-1 bg-[#141414] border border-[#2a2a2a] rounded-xl overflow-hidden cursor-pointer active:bg-[#1a1a1a] transition-colors"
            onClick={() => navigate('/map')}
          >
            <div className="px-3 pt-2 pb-1 flex items-center justify-between">
              <span className="text-xs text-[#9ca3af] uppercase tracking-wider">{t('home.position')}</span>
              {liveActive && (
                <span className="inline-flex items-center gap-1 text-[10px] font-medium text-[#22c55e] uppercase tracking-wider">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#22c55e] animate-pulse" />
                  {t('home.live')}
                </span>
              )}
            </div>
            <div className="h-[160px] sm:h-[220px]">
              <Map
                longitude={lng}
                latitude={lat}
                zoom={15}
                mapStyle={mapStyle.styleUrl}
                interactive={false}
                attributionControl={false}
                style={{ width: '100%', height: '100%' }}
              >
                <Marker longitude={lng} latitude={lat} anchor="center">
                  <div style={DOT_STYLE} />
                </Marker>
              </Map>
            </div>
            <div className="px-3 py-2">
              {address && (
                <p className="text-sm text-white truncate">{address}</p>
              )}
              {liveActive ? (
                <p className="text-xs text-[#22c55e] mt-0.5">{t('home.liveNow')}</p>
              ) : vehicle.positionDate && (
                <p className="text-xs text-[#6b7280] mt-0.5">
                  {utcDate(vehicle.positionDate).toLocaleString()}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Trip in progress / last completed trip */}
        {(() => {
          if (tripInProgress) {
            const startMs = activeDrive?.startDate ? utcDate(activeDrive.startDate).getTime() : null;
            const elapsedMin = startMs != null ? Math.max(0, Math.round((nowTick - startMs) / 60_000)) : null;
            const distanceKm =
              activeDrive?.startKm != null && (live?.odometer ?? vehicle?.odometer) != null
                ? Math.max(0, (live?.odometer ?? vehicle!.odometer!) - activeDrive.startKm)
                : null;
            const speedKmh = live?.speed ?? null;
            const powerKw = live?.power ?? null;

            const route = live?.activeRouteDestination ? {
              destination: live.activeRouteDestination,
              minutesToArrival: live.activeRouteMinutesToArrival,
              milesToArrival: live.activeRouteMilesToArrival,
              energyAtArrival: live.activeRouteEnergyAtArrival,
              trafficDelay: live.activeRouteTrafficMinutesDelay,
            } : null;
            const routeDistanceUserUnit = route?.milesToArrival != null
              ? (u.distanceUnit === 'mi' ? route.milesToArrival : route.milesToArrival * 1.609344)
              : null;
            const etaTime = route?.minutesToArrival != null
              ? new Date(nowTick + route.minutesToArrival * 60_000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
              : null;
            return (
              <div className="flex-1 bg-[#141414] border border-[#22c55e]/40 rounded-xl p-3 sm:p-4 flex flex-col overflow-hidden">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs text-[#9ca3af] uppercase tracking-wider">{t('home.tripInProgress')}</div>
                  <span className="inline-flex items-center gap-1 text-[10px] font-medium text-[#22c55e] uppercase tracking-wider">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#22c55e] animate-pulse" />
                    {liveConnected ? t('home.live') : t('home.mqttOffline')}
                  </span>
                </div>
                {activeDrive?.startAddress && (
                  <div className="text-sm font-medium truncate">
                    {activeDrive.startAddress.split(',')[0]} →{' '}
                    <span className="text-[#22c55e]">{address ?? '…'}</span>
                  </div>
                )}
                {!activeDrive && (
                  <div className="text-sm font-medium truncate">
                    <span className="text-[#22c55e]">{address ?? t('home.tripWaitingPosition')}</span>
                  </div>
                )}
                <div className="grid grid-cols-3 gap-2 mt-3">
                  <div>
                    <div className="text-[10px] text-[#9ca3af] uppercase tracking-wider">{t('home.tripSpeed')}</div>
                    <div className="text-base font-bold tabular-nums text-[#22c55e]">
                      {speedKmh != null ? u.fmtSpeed(speedKmh) : '—'}{' '}
                      <span className="text-[10px] font-normal text-[#9ca3af]">{u.speedUnit}</span>
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-[#9ca3af] uppercase tracking-wider">{t('home.tripDistance')}</div>
                    <div className="text-base font-bold tabular-nums text-white">
                      {distanceKm != null ? u.fmtDist(distanceKm) : '—'}{' '}
                      <span className="text-[10px] font-normal text-[#9ca3af]">{u.distanceUnit}</span>
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-[#9ca3af] uppercase tracking-wider">{t('home.tripElapsed')}</div>
                    <div className="text-base font-bold tabular-nums text-white">
                      {elapsedMin != null ? `${elapsedMin}` : '—'}{' '}
                      <span className="text-[10px] font-normal text-[#9ca3af]">min</span>
                    </div>
                  </div>
                </div>
                {powerKw != null && (
                  <div className="mt-2 text-xs text-[#9ca3af]">
                    {t('home.tripPower')}:{' '}
                    <span
                      className="tabular-nums font-medium"
                      style={{ color: powerKw >= 0 ? '#e31937' : '#22c55e' }}
                    >
                      {powerKw > 0 ? '+' : ''}
                      {powerKw.toFixed(1)} kW
                    </span>
                  </div>
                )}

                {route && (
                  <div className="mt-3 pt-3 border-t border-[#2a2a2a]">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-[10px] text-[#9ca3af] uppercase tracking-wider">{t('home.tripDestination')}</div>
                        <div className="text-sm font-medium text-white truncate">→ {route.destination}</div>
                      </div>
                      {route.minutesToArrival != null && (
                        <div className="text-right flex-shrink-0">
                          <div className="text-[10px] text-[#9ca3af] uppercase tracking-wider">{t('home.tripEta')}</div>
                          <div className="text-sm font-bold tabular-nums text-[#22c55e]">
                            {etaTime} <span className="text-[10px] font-normal text-[#9ca3af]">({Math.round(route.minutesToArrival)} min)</span>
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="mt-1 text-xs text-[#9ca3af] flex items-center gap-x-3 gap-y-0.5 flex-wrap">
                      {routeDistanceUserUnit != null && (
                        <span className="tabular-nums">{routeDistanceUserUnit.toFixed(routeDistanceUserUnit < 10 ? 1 : 0)} {u.distanceUnit}</span>
                      )}
                      {route.energyAtArrival != null && (
                        <span className="tabular-nums">
                          <span className="text-[#22c55e]">{Math.round(route.energyAtArrival)}%</span> {t('home.tripAtArrival')}
                        </span>
                      )}
                      {route.trafficDelay != null && route.trafficDelay > 0.5 && (
                        <span className="tabular-nums text-[#eab308]">+{Math.round(route.trafficDelay)} min {t('home.tripTraffic')}</span>
                      )}
                    </div>
                  </div>
                )}
                {!route && live?.activeRouteError && (
                  <div className="mt-3 pt-3 border-t border-[#2a2a2a] text-[10px] text-[#6b7280]">
                    {t('home.tripNoRoute')}
                  </div>
                )}
                {activeDrive == null && liveConnected && (
                  <div className="text-[10px] text-[#6b7280] mt-2">{t('home.tripWaitingDb')}</div>
                )}
                {activeDrive?.startDate && (
                  <div className="text-[10px] text-[#6b7280] mt-2">
                    {t('home.tripStartedAt', {
                      time: utcDate(activeDrive.startDate).toLocaleString(undefined, {
                        day: '2-digit',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      }),
                    })}
                  </div>
                )}
              </div>
            );
          }

          return (
            <div
              className="flex-1 bg-[#141414] border border-[#2a2a2a] rounded-xl p-3 sm:p-4 flex flex-col cursor-pointer active:bg-[#1a1a1a] transition-colors overflow-hidden"
              onClick={() => tripDisplay && navigate(`/map?driveId=${tripDisplay.id}`)}
            >
              <div className="text-xs text-[#9ca3af] uppercase tracking-wider mb-2">{t('home.latestTrip')}</div>
              {tripDisplay ? (
                <div className="flex-1 flex flex-col justify-center min-w-0">
                  <div className="text-sm font-medium truncate">
                    {tripDisplay.startAddress?.split(',')[0] ?? '?'} → {tripDisplay.endAddress?.split(',')[0] ?? '?'}
                  </div>
                  <div className="text-[#9ca3af] text-sm mt-1">
                    {u.fmtDist(tripDisplay.distance)} {u.distanceUnit} · {tripDisplay.durationMin ?? '?'} min
                    {tripDisplay.distance != null && tripCostPerKm != null && tripCostPerKm > 0 && (
                      <> · <span className="text-[#eab308]">{(tripDisplay.distance * tripCostPerKm).toFixed(2)} {u.currencySymbol}</span></>
                    )}
                  </div>
                  {tripDisplay.consumptionKWhPer100Km != null && (
                    <div className="text-[#9ca3af] text-sm">
                      {u.fmtConsumption(tripDisplay.consumptionKWhPer100Km)} {u.consumptionUnit}
                    </div>
                  )}
                  <div className="text-[#6b7280] text-xs mt-2">
                    {utcDate(tripDisplay.startDate).toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    {tripDisplay.endDate && (
                      <> → {utcDate(tripDisplay.endDate).toLocaleString(undefined, { hour: '2-digit', minute: '2-digit' })}</>
                    )}
                  </div>
                </div>
              ) : (
                <div className="text-[#6b7280] text-sm text-center flex-1 flex items-center justify-center">
                  {t('home.noTrips')}
                </div>
              )}
            </div>
          );
        })()}
      </div>

    </div>
  );
}
