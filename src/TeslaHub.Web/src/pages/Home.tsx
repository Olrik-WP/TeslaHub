import { useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet';
import { useVehicleStatus } from '../hooks/useVehicle';
import { useChargingSessions } from '../hooks/useCharging';
import { useDrives } from '../hooks/useDrives';
import { useUnits } from '../hooks/useUnits';
import BatteryGauge from '../components/BatteryGauge';
import StatCard from '../components/StatCard';
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
    idealBatteryRangeKm: vehicle.idealBatteryRangeKm ?? lastKnown.current.idealBatteryRangeKm ?? null,
    batteryLevel: vehicle.batteryLevel ?? lastKnown.current.batteryLevel ?? null,
    latitude: vehicle.latitude ?? lastKnown.current.latitude ?? null,
    longitude: vehicle.longitude ?? lastKnown.current.longitude ?? null,
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
  const u = useUnits();

  const lastDrive = drives?.[0];
  const lastCharge = charges?.[0];
  const isCharging = lastCharge && !lastCharge.endDate;

  if (!vehicle) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="text-[#9ca3af] text-lg">Loading vehicle data...</div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      {/* Vehicle identity */}
      <div className="text-center mb-2">
        <h1 className="text-xl font-bold">
          {vehicle.marketingName || vehicle.model || vehicle.name}
        </h1>
        {vehicle.trimBadging && (
          <p className="text-[#9ca3af] text-sm">{vehicle.trimBadging}</p>
        )}
        {vehicle.exteriorColor && (
          <p className="text-[#6b7280] text-xs mt-0.5">{vehicle.exteriorColor}</p>
        )}
        {vehicle.vin && (
          <p className="text-[#6b7280] text-xs mt-0.5">VIN {vehicle.vin}</p>
        )}
      </div>

      {/* Vehicle image placeholder */}
      <div className="flex items-center justify-center h-8 border-2 border-dashed border-[#2a2a2a] rounded-xl">
        <span className="text-[#6b7280] text-xs">Vehicle image</span>
      </div>

      {/* Battery gauge */}
      <div className="flex justify-center">
        <BatteryGauge
          level={vehicle.batteryLevel ?? 0}
          rangeKm={u.convertDistance(vehicle.ratedBatteryRangeKm)}
          rangeUnit={u.distanceUnit}
          isCharging={isCharging}
        />
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="Odometer"
          value={vehicle.odometer ? Math.round(u.convertDistance(vehicle.odometer)!).toLocaleString() : '—'}
          unit={u.distanceUnit}
        />
        <StatCard
          label="Rated range"
          value={vehicle.ratedBatteryRangeKm ? Math.round(u.convertDistance(vehicle.ratedBatteryRangeKm)!) : '—'}
          unit={u.distanceUnit}
          color="#22c55e"
        />
        <StatCard
          label="Ideal range"
          value={vehicle.idealBatteryRangeKm ? Math.round(u.convertDistance(vehicle.idealBatteryRangeKm)!) : '—'}
          unit={u.distanceUnit}
          color="#22c55e"
        />
        <StatCard
          label="Efficiency"
          value={vehicle.efficiency?.toFixed(3) ?? '—'}
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
          label="Battery"
          value={vehicle.batteryLevel ?? '—'}
          unit="%"
          color="#22c55e"
        />
        <StatCard
          label="State"
          value={vehicle.state ?? '—'}
        />
      </div>

      {/* Mini-map: current position */}
      {vehicle.latitude != null && vehicle.longitude != null && (
        <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl overflow-hidden">
          <div className="px-4 pt-3 pb-2 flex items-center justify-between">
            <span className="text-xs text-[#9ca3af] uppercase tracking-wider">Current position</span>
            {vehicle.positionDate && (
              <span className="text-xs text-[#6b7280]">
                {new Date(vehicle.positionDate).toLocaleString()}
              </span>
            )}
          </div>
          <div className="h-[200px]">
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
                radius={10}
                fillColor="#e31937"
                fillOpacity={1}
                color="#ffffff"
                weight={3}
              >
                <Popup>{vehicle.name || 'My Tesla'}</Popup>
              </CircleMarker>
            </MapContainer>
          </div>
        </div>
      )}

      {/* Last trip (clickable → map) */}
      {lastDrive && (
        <div
          className="bg-[#141414] border border-[#2a2a2a] rounded-xl p-4 cursor-pointer active:bg-[#1a1a1a] transition-colors"
          onClick={() => navigate(`/map?driveId=${lastDrive.id}`)}
        >
          <div className="text-xs text-[#9ca3af] uppercase tracking-wider mb-2">Latest trip</div>
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium text-sm">
                {lastDrive.startAddress?.split(',')[0] ?? '?'}{' → '}
                {lastDrive.endAddress?.split(',')[0] ?? '?'}
              </div>
              <div className="text-[#9ca3af] text-xs mt-1">
                {u.fmtDist(lastDrive.distance)} {u.distanceUnit}
                {' · '}
                {lastDrive.durationMin ?? '?'} min
                {lastDrive.consumptionKWhPer100Km != null && (
                  <> · {u.fmtConsumption(lastDrive.consumptionKWhPer100Km)} {u.consumptionUnit}</>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[#9ca3af] text-xs">
                {new Date(lastDrive.startDate).toLocaleDateString()}
              </span>
              <span className="text-[#9ca3af]">›</span>
            </div>
          </div>
        </div>
      )}

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
