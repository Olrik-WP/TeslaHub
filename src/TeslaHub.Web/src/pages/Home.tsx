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
import { getStats } from '../api/queries';
import type { VehicleStatus } from '../api/queries';

interface Props {
  carId: number | undefined;
}

function useStickyVehicle(vehicle: VehicleStatus | undefined) {
  const lastKnown = useRef<Partial<VehicleStatus>>({});

  if (vehicle) {
    for (const key of Object.keys(vehicle) as (keyof VehicleStatus)[]) {
      if (vehicle[key] != null) {
        (lastKnown.current as any)[key] = vehicle[key];
      }
    }
  }

  if (!vehicle) return undefined;

  return {
    ...vehicle,
    odometer: vehicle.odometer ?? lastKnown.current.odometer ?? null,
    outsideTemp: vehicle.outsideTemp ?? lastKnown.current.outsideTemp ?? null,
    insideTemp: vehicle.insideTemp ?? lastKnown.current.insideTemp ?? null,
    ratedBatteryRangeKm: vehicle.ratedBatteryRangeKm ?? lastKnown.current.ratedBatteryRangeKm ?? null,
    batteryLevel: vehicle.batteryLevel ?? lastKnown.current.batteryLevel ?? null,
    latitude: vehicle.latitude ?? lastKnown.current.latitude ?? null,
    longitude: vehicle.longitude ?? lastKnown.current.longitude ?? null,
    firmwareVersion: vehicle.firmwareVersion ?? lastKnown.current.firmwareVersion ?? null,
    currentCapacityKwh: vehicle.currentCapacityKwh ?? lastKnown.current.currentCapacityKwh ?? null,
    maxCapacityKwh: vehicle.maxCapacityKwh ?? lastKnown.current.maxCapacityKwh ?? null,
  };
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
  const u = useUnits();
  const [imgError, setImgError] = useState(false);
  const [address, setAddress] = useState<string | null>(null);

  const lastDrive = drives?.[0];
  const lastCharge = charges?.[0];
  const isCharging = lastCharge && !lastCharge.endDate;
  const imgSrc = carId ? `/api/vehicle/${carId}/image` : null;

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
        <div className="text-[#9ca3af] text-lg">Loading vehicle data...</div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="text-center">
        <h1 className="text-xl font-bold">
          {vehicle.marketingName || vehicle.model || vehicle.name}
        </h1>
        <p className="text-sm text-[#9ca3af] mt-1">
          {[vehicle.exteriorColor, vehicle.vin ? `VIN ${vehicle.vin}` : null]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </div>

      {/* Hero: Vehicle image with battery gauge overlay */}
      <div className="relative bg-[#141414] rounded-xl overflow-hidden">
        <div className="flex items-center justify-center h-[220px]">
          {imgSrc && !imgError ? (
            <img
              src={imgSrc}
              alt={vehicle.name || 'Tesla'}
              className="max-h-[200px] w-auto object-contain"
              onError={() => setImgError(true)}
            />
          ) : (
            <span className="text-[#6b7280]">Vehicle image</span>
          )}
        </div>
        <div className="absolute bottom-2 right-2 bg-black/60 rounded-xl p-1">
          <BatteryGauge
            level={vehicle.batteryLevel ?? 0}
            rangeKm={u.convertDistance(vehicle.ratedBatteryRangeKm)}
            rangeUnit={u.distanceUnit}
            isCharging={isCharging}
          />
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard
          label="Odometer"
          value={vehicle.odometer ? Math.round(u.convertDistance(vehicle.odometer)!).toLocaleString() : '—'}
          unit={u.distanceUnit}
        />
        <StatCard
          label="Range"
          value={vehicle.ratedBatteryRangeKm ? Math.round(u.convertDistance(vehicle.ratedBatteryRangeKm)!) : '—'}
          unit={u.distanceUnit}
          color="#22c55e"
          progress={vehicle.batteryLevel}
        />
        <StatCard
          label="Firmware"
          value={vehicle.firmwareVersion?.split(' ')[0] ?? '—'}
        />
        <StatCard
          label="Ext. temp"
          value={u.fmtTemp(vehicle.outsideTemp)}
          unit={u.tempUnit}
        />
        <StatCard
          label="Int. temp"
          value={u.fmtTemp(vehicle.insideTemp)}
          unit={u.tempUnit}
        />
        <StatCard
          label="State"
          value={vehicle.state ?? '—'}
        />
        {stats?.avgConsumptionKWhPer100Km != null && stats.avgConsumptionKWhPer100Km > 0 && (
          <StatCard
            label="Avg. consumption"
            value={u.fmtConsumption(stats.avgConsumptionKWhPer100Km)}
            unit={u.consumptionUnit}
          />
        )}
        {storedEnergy != null && (
          <StatCard
            label="Stored energy"
            value={storedEnergy.toFixed(1)}
            unit="kWh"
            color="#3b82f6"
          />
        )}
        {currentCapacity != null && (
          <StatCard
            label="Usable (100%)"
            value={currentCapacity.toFixed(1)}
            unit="kWh"
          />
        )}
        {degradation != null && (
          <StatCard
            label="Degradation"
            value={degradation.toFixed(1)}
            unit="%"
            color={degradationColor}
          />
        )}
      </div>

      {/* Map + Last trip */}
      <div className="flex gap-3" style={{ minHeight: 260 }}>
        {vehicle.latitude != null && vehicle.longitude != null && (
          <div className="flex-1 bg-[#141414] border border-[#2a2a2a] rounded-xl overflow-hidden">
            <div className="px-3 pt-2 pb-1">
              <span className="text-xs text-[#9ca3af] uppercase tracking-wider">Position</span>
            </div>
            <div className="h-[220px]">
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
                  {new Date(vehicle.positionDate).toLocaleString()}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Last trip */}
        <div
          className="flex-1 bg-[#141414] border border-[#2a2a2a] rounded-xl p-4 flex flex-col cursor-pointer active:bg-[#1a1a1a] transition-colors overflow-hidden"
          onClick={() => lastDrive && navigate(`/map?driveId=${lastDrive.id}`)}
        >
          <div className="text-xs text-[#9ca3af] uppercase tracking-wider mb-2">Latest trip</div>
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
                {new Date(lastDrive.startDate).toLocaleDateString()}
              </div>
            </div>
          ) : (
            <div className="text-[#6b7280] text-sm text-center flex-1 flex items-center justify-center">
              No trips yet
            </div>
          )}
        </div>
      </div>

      {/* Charging in progress */}
      {isCharging && lastCharge && (
        <div className="bg-[#141414] border border-[#3b82f6]/30 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[#3b82f6] text-lg">⚡</span>
            <span className="font-medium">Charging in progress</span>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <StatCard
              label="Added"
              value={lastCharge.chargeEnergyAdded?.toFixed(1) ?? '—'}
              unit="kWh"
              color="#3b82f6"
            />
            <StatCard
              label="Battery"
              value={`${lastCharge.startBatteryLevel ?? '?'} → ${vehicle.batteryLevel ?? '?'}`}
              unit="%"
            />
            <StatCard
              label="Duration"
              value={lastCharge.durationMin ?? '—'}
              unit="min"
            />
          </div>
        </div>
      )}
    </div>
  );
}
