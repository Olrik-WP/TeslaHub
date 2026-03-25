import { useRef } from 'react';
import { useVehicleStatus } from '../hooks/useVehicle';
import { useChargingSessions } from '../hooks/useCharging';
import { useDrives } from '../hooks/useDrives';
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
    batteryLevel: vehicle.batteryLevel ?? lastKnown.current.batteryLevel ?? null,
  };
}

export default function Home({ carId }: Props) {
  const { data: rawVehicle } = useVehicleStatus(carId);
  const vehicle = useStickyVehicle(rawVehicle);
  const { data: charges } = useChargingSessions(carId, 5);
  const { data: drives } = useDrives(carId, 5);

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
      <div className="text-center mb-2">
        <h1 className="text-xl font-bold">
          {vehicle.name || vehicle.marketingName || vehicle.model}
        </h1>
        {vehicle.vin && (
          <p className="text-[#9ca3af] text-xs mt-1">{vehicle.vin}</p>
        )}
      </div>

      <div className="flex justify-center">
        <BatteryGauge
          level={vehicle.batteryLevel ?? 0}
          rangeKm={vehicle.ratedBatteryRangeKm}
          isCharging={isCharging}
        />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="Odometer"
          value={vehicle.odometer ? Math.round(vehicle.odometer).toLocaleString() : '—'}
          unit="km"
        />
        <StatCard
          label="Ext. temp"
          value={vehicle.outsideTemp != null ? Math.round(vehicle.outsideTemp) : '—'}
          unit="°C"
        />
        <StatCard
          label="Int. temp"
          value={vehicle.insideTemp != null ? Math.round(vehicle.insideTemp) : '—'}
          unit="°C"
        />
        <StatCard
          label="Range"
          value={vehicle.ratedBatteryRangeKm ? Math.round(vehicle.ratedBatteryRangeKm) : '—'}
          unit="km"
          color="#22c55e"
        />
      </div>

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

      {lastDrive && (
        <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl p-4">
          <div className="text-xs text-[#9ca3af] uppercase tracking-wider mb-2">Latest trip</div>
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium text-sm">
                {lastDrive.startAddress?.split(',')[0] ?? '?'}{' → '}
                {lastDrive.endAddress?.split(',')[0] ?? '?'}
              </div>
              <div className="text-[#9ca3af] text-xs mt-1">
                {lastDrive.distance ? (lastDrive.distance / 1000).toFixed(1) : '?'} km
                {' · '}
                {lastDrive.durationMin ?? '?'} min
                {lastDrive.consumptionKWhPer100Km != null && (
                  <> · {lastDrive.consumptionKWhPer100Km.toFixed(1)} kWh/100km</>
                )}
              </div>
            </div>
            <div className="text-[#9ca3af] text-xs">
              {new Date(lastDrive.startDate).toLocaleDateString()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
