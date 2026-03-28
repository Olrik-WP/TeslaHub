import { useRef, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet';
import { useVehicleStatus } from '../hooks/useVehicle';
import { useChargingSessions } from '../hooks/useCharging';
import { useDrives } from '../hooks/useDrives';
import { useUnits } from '../hooks/useUnits';
import BatteryGauge from '../components/BatteryGauge';
import StatCard from '../components/StatCard';
import { getStats, getChargingStats, getDriveStats, getSettings, getCostOverrides } from '../api/queries';
import type { VehicleStatus } from '../api/queries';
import { useTranslation } from 'react-i18next';
import { utcDate } from '../utils/date';

interface Props {
  carId: number | undefined;
}

const STICKY_KEY = 'teslahub_sticky_vehicle';
const STICKY_FIELDS: (keyof VehicleStatus)[] = [
  'odometer', 'outsideTemp', 'insideTemp', 'ratedBatteryRangeKm',
  'batteryLevel', 'latitude', 'longitude', 'firmwareVersion',
  'currentCapacityKwh', 'maxCapacityKwh', 'usableBatteryLevel',
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

function RecenterMap({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView([lat, lng]);
  }, [map, lat, lng]);
  return null;
}

export default function Home({ carId }: Props) {
  const navigate = useNavigate();
  const { data: rawVehicle } = useVehicleStatus(carId);
  const vehicle = useStickyVehicle(rawVehicle);
  const { data: charges } = useChargingSessions(carId, 5);
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
  const costSource = settings?.costSource ?? 'teslahub';
  const { data: overrides } = useQuery({
    queryKey: ['costOverrides', carId],
    queryFn: () => getCostOverrides(carId!),
    enabled: !!carId && costSource === 'teslahub',
    staleTime: 5 * 60_000,
  });
  const u = useUnits();
  const { t } = useTranslation();
  const [imgError, setImgError] = useState(false);
  const [address, setAddress] = useState<string | null>(null);

  const lastDrive = drives?.[0];
  const lastCharge = charges?.[0];
  const isCharging = lastCharge && !lastCharge.endDate;
  const lastCompletedCharge = charges?.find((s) => s.endDate);
  const imgSrc = carId ? `/api/vehicle/${carId}/image` : null;

  const lastChargeCost = (() => {
    if (!lastCompletedCharge) return null;
    if (costSource === 'teslahub') {
      const ov = overrides?.find((o) => o.chargingProcessId === lastCompletedCharge.id);
      if (ov) return ov.isFree ? 0 : ov.totalCost;
      return null;
    }
    return lastCompletedCharge.cost;
  })();

  const kmSinceLastCharge = (() => {
    if (!vehicle?.odometer || !lastCompletedCharge?.odometer) return null;
    const diff = vehicle.odometer - lastCompletedCharge.odometer;
    return diff >= 0 ? diff : null;
  })();

  const costPerKm = (() => {
    if (lastChargeCost == null || lastChargeCost <= 0 || !kmSinceLastCharge || kmSinceLastCharge < 1) return null;
    return lastChargeCost / u.convertDistance(kmSinceLastCharge)!;
  })();

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

  const lat = vehicle?.latitude;
  const lng = vehicle?.longitude;
  useEffect(() => {
    if (lat == null || lng == null) return;
    const controller = new AbortController();
    fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=18`,
      { signal: controller.signal, headers: { 'Accept-Language': 'fr' } }
    )
      .then(r => r.json())
      .then(d => {
        if (d.display_name) {
          setAddress(d.display_name.split(',').slice(0, 3).join(',').trim());
        }
      })
      .catch(() => {});
    return () => controller.abort();
  }, [lat, lng]);

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
            {lastCompletedCharge && (
              <div className="text-right cursor-pointer" onClick={() => navigate('/charging')}>
                <div className="text-[10px] text-[#9ca3af] uppercase tracking-wider">{t('home.lastCharge')}</div>
                <div className="text-base font-bold tabular-nums text-[#e31937]">
                  {lastChargeCost != null && lastChargeCost > 0
                    ? `${lastChargeCost.toFixed(2)} ${u.currencySymbol}`
                    : `${lastCompletedCharge.chargeEnergyAdded?.toFixed(0) ?? '—'} kWh`}
                </div>
                {kmSinceLastCharge != null && kmSinceLastCharge >= 1 && (
                  <div className="text-[10px] text-[#9ca3af]">
                    {Math.round(u.convertDistance(kmSinceLastCharge)!)} {u.distanceUnit} {t('home.sinceCharge')}
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
          {lastCompletedCharge && (
            <div
              className="hidden sm:block absolute right-[230px] bottom-2 z-20 bg-black/60 rounded-xl px-3 py-2 text-center cursor-pointer hover:bg-black/80 transition-colors"
              onClick={() => navigate('/charging')}
            >
              <div className="text-[10px] text-[#9ca3af] uppercase tracking-wider">{t('home.lastCharge')}</div>
              <div className="text-xl font-bold tabular-nums text-[#e31937]">
                {lastChargeCost != null && lastChargeCost > 0
                  ? `${lastChargeCost.toFixed(2)} ${u.currencySymbol}`
                  : `${lastCompletedCharge.chargeEnergyAdded?.toFixed(0) ?? '—'} kWh`}
              </div>
              {kmSinceLastCharge != null && kmSinceLastCharge >= 1 && (
                <div className="text-[10px] text-[#9ca3af]">
                  {Math.round(u.convertDistance(kmSinceLastCharge)!)} {u.distanceUnit} {t('home.sinceCharge')}
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

        {/* Bottom row: mileage extrapolations */}
        {driveStats && driveStats.driveCount > 0 && (
          <div className="grid grid-cols-3 border-t border-[#2a2a2a]">
            <div className="px-3 py-2 text-center">
              <div className="text-xs text-[#9ca3af] uppercase tracking-wider">{t('home.estMonthly')}</div>
              <div className="text-base font-bold tabular-nums text-[#e31937]">{Math.round(u.convertDistance(driveStats.totalMileageKm / driveStats.totalDays * (365 / 12))!).toLocaleString()} <span className="text-[11px] font-normal text-[#9ca3af]">{u.distanceUnit}</span></div>
            </div>
            <div className="px-3 py-2 text-center border-x border-[#2a2a2a]">
              <div className="text-xs text-[#9ca3af] uppercase tracking-wider">{driveStats.driveCount} {t('home.trips')}</div>
              <div className="text-base font-bold tabular-nums text-[#e31937]">{Math.round(driveStats.totalDays)} <span className="text-[11px] font-normal text-[#9ca3af]">{t('home.days')}</span></div>
            </div>
            <div className="px-3 py-2 text-center">
              <div className="text-xs text-[#9ca3af] uppercase tracking-wider">{t('home.estAnnual')}</div>
              <div className="text-base font-bold tabular-nums text-[#e31937]">{Math.round(u.convertDistance(driveStats.totalMileageKm / driveStats.totalDays * 365)!).toLocaleString()} <span className="text-[11px] font-normal text-[#9ca3af]">{u.distanceUnit}</span></div>
            </div>
          </div>
        )}
      </div>

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
      </div>

      {/* Map + Last trip */}
      <div className="flex flex-col sm:flex-row gap-3" style={{ minHeight: 200 }}>
        {vehicle.latitude != null && vehicle.longitude != null && (
          <div
            className="flex-1 bg-[#141414] border border-[#2a2a2a] rounded-xl overflow-hidden cursor-pointer active:bg-[#1a1a1a] transition-colors"
            onClick={() => navigate(`/map?lat=${vehicle.latitude}&lng=${vehicle.longitude}`)}
          >
            <div className="px-3 pt-2 pb-1">
              <span className="text-xs text-[#9ca3af] uppercase tracking-wider">{t('home.position')}</span>
            </div>
            <div className="h-[160px] sm:h-[220px]">
              <MapContainer
                center={[vehicle.latitude, vehicle.longitude]}
                zoom={15}
                className="w-full h-full"
                zoomControl={false}
                attributionControl={false}
                dragging={false}
                scrollWheelZoom={false}
                doubleClickZoom={false}
                touchZoom={false}
              >
                <TileLayer
                  url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
                  maxZoom={19}
                  className="dark-mode-tiles"
                />
                <RecenterMap lat={vehicle.latitude} lng={vehicle.longitude} />
                <CircleMarker
                  center={[vehicle.latitude, vehicle.longitude]}
                  radius={8}
                  fillColor="#e31937"
                  fillOpacity={1}
                  color="#ffffff"
                  weight={3}
                >
                  <Popup>{vehicle.name || 'My Tesla'}</Popup>
                </CircleMarker>
              </MapContainer>
            </div>
            <div className="px-3 py-2">
              {address && (
                <p className="text-sm text-white truncate">{address}</p>
              )}
              {vehicle.positionDate && (
                <p className="text-xs text-[#6b7280] mt-0.5">
                  {utcDate(vehicle.positionDate).toLocaleString()}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Last trip */}
        <div
          className="flex-1 bg-[#141414] border border-[#2a2a2a] rounded-xl p-3 sm:p-4 flex flex-col cursor-pointer active:bg-[#1a1a1a] transition-colors overflow-hidden"
          onClick={() => lastDrive && navigate(`/map?driveId=${lastDrive.id}`)}
        >
          <div className="text-xs text-[#9ca3af] uppercase tracking-wider mb-2">{t('home.latestTrip')}</div>
          {lastDrive ? (
            <div className="flex-1 flex flex-col justify-center min-w-0">
              <div className="text-sm font-medium truncate">
                {lastDrive.startAddress?.split(',')[0] ?? '?'} → {lastDrive.endAddress?.split(',')[0] ?? '?'}
              </div>
              <div className="text-[#9ca3af] text-sm mt-1">
                {u.fmtDist(lastDrive.distance)} {u.distanceUnit} · {lastDrive.durationMin ?? '?'} min
              </div>
              {lastDrive.consumptionKWhPer100Km != null && (
                <div className="text-[#9ca3af] text-sm">
                  {u.fmtConsumption(lastDrive.consumptionKWhPer100Km)} {u.consumptionUnit}
                </div>
              )}
              <div className="text-[#6b7280] text-xs mt-2">
                {utcDate(lastDrive.startDate).toLocaleDateString()}
              </div>
            </div>
          ) : (
            <div className="text-[#6b7280] text-sm text-center flex-1 flex items-center justify-center">
              {t('home.noTrips')}
            </div>
          )}
        </div>
      </div>

      {/* Charging in progress */}
      {isCharging && lastCharge && (
        <div className="bg-[#141414] border border-[#3b82f6]/30 rounded-xl p-3 sm:p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[#3b82f6] text-lg">⚡</span>
            <span className="font-medium">{t('home.chargingInProgress')}</span>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <StatCard
              label={t('home.added')}
              value={lastCharge.chargeEnergyAdded?.toFixed(1) ?? '—'}
              unit="kWh"
              color="#3b82f6"
            />
            <StatCard
              label={t('home.battery')}
              value={`${lastCharge.startBatteryLevel ?? '?'} → ${vehicle.batteryLevel ?? '?'}`}
              unit="%"
            />
            <StatCard
              label={t('home.duration')}
              value={lastCharge.durationMin ?? '—'}
              unit="min"
            />
          </div>
        </div>
      )}
    </div>
  );
}
