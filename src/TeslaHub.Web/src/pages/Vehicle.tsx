import { useVehicleStatus } from '../hooks/useVehicle';
import BatteryGauge from '../components/BatteryGauge';
import StatCard from '../components/StatCard';

interface Props {
  carId: number | undefined;
}

export default function Vehicle({ carId }: Props) {
  const { data: vehicle, isLoading } = useVehicleStatus(carId);

  if (isLoading) {
    return <div className="flex items-center justify-center h-[60vh] text-[#9ca3af]">Loading...</div>;
  }

  if (!vehicle) {
    return <div className="flex items-center justify-center h-[60vh] text-[#9ca3af]">Vehicle not found</div>;
  }

  return (
    <div className="p-4 space-y-4">
      <div className="text-center">
        <h1 className="text-xl font-bold">{vehicle.marketingName || vehicle.model || vehicle.name}</h1>
        {vehicle.trimBadging && (
          <p className="text-[#9ca3af] text-sm">{vehicle.trimBadging}</p>
        )}
        {vehicle.vin && <p className="text-[#6b7280] text-xs mt-1">VIN: {vehicle.vin}</p>}
      </div>

      <div className="flex justify-center">
        <BatteryGauge level={vehicle.batteryLevel ?? 0} rangeKm={vehicle.ratedBatteryRangeKm} />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <StatCard label="Odometer" value={vehicle.odometer ? Math.round(vehicle.odometer).toLocaleString() : '—'} unit="km" />
        <StatCard label="Ext. temp" value={vehicle.outsideTemp != null ? Math.round(vehicle.outsideTemp) : '—'} unit="°C" />
        <StatCard label="Int. temp" value={vehicle.insideTemp != null ? Math.round(vehicle.insideTemp) : '—'} unit="°C" />
        <StatCard label="Battery" value={vehicle.batteryLevel ?? '—'} unit="%" color="#22c55e" />
        <StatCard label="Rated range" value={vehicle.ratedBatteryRangeKm ? Math.round(vehicle.ratedBatteryRangeKm) : '—'} unit="km" />
        <StatCard label="Ideal range" value={vehicle.idealBatteryRangeKm ? Math.round(vehicle.idealBatteryRangeKm) : '—'} unit="km" />
        <StatCard label="Efficiency" value={vehicle.efficiency?.toFixed(3) ?? '—'} />
        <StatCard label="Color" value={vehicle.exteriorColor ?? '—'} />
      </div>

      {vehicle.latitude != null && vehicle.longitude != null && (
        <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl p-4">
          <div className="text-xs text-[#9ca3af] uppercase tracking-wider mb-1">Last known position</div>
          <p className="text-sm tabular-nums">{vehicle.latitude.toFixed(5)}, {vehicle.longitude.toFixed(5)}</p>
          {vehicle.positionDate && (
            <p className="text-xs text-[#6b7280] mt-1">{new Date(vehicle.positionDate).toLocaleString()}</p>
          )}
        </div>
      )}
    </div>
  );
}
