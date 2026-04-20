import { useTranslation } from 'react-i18next';
import type { Car, VehicleStatus } from '../api/queries';
import { useVehicleStatus } from '../hooks/useVehicle';
import { useUnits } from '../hooks/useUnits';

interface Props {
  cars: Car[];
  selectedId: number | undefined;
  onChange: (id: number) => void;
}

export default function CarSelector({ cars, selectedId, onChange }: Props) {
  if (cars.length <= 1) return null;

  return (
    <div className="flex gap-2 px-4 py-2 overflow-x-auto">
      {cars.map((car) => (
        <CarChip
          key={car.id}
          car={car}
          active={selectedId === car.id}
          onClick={() => onChange(car.id)}
        />
      ))}
    </div>
  );
}

interface ChipProps {
  car: Car;
  active: boolean;
  onClick: () => void;
}

function CarChip({ car, active, onClick }: ChipProps) {
  const { t } = useTranslation();
  const u = useUnits();
  // Reuses the existing per-car query from useVehicleStatus, so this is
  // deduped with the polling that Home/Map already do for the active car.
  const { data: status } = useVehicleStatus(car.id);

  const label = car.name || car.marketingName || car.model || `Car ${car.id}`;
  const indicator = stateIndicator(status, t);
  const battery = formatBattery(status, u);

  return (
    <button
      onClick={onClick}
      className={`flex-shrink-0 flex flex-col items-start text-left rounded-lg px-3 py-1.5 min-h-[44px] whitespace-nowrap transition-colors duration-150 ${
        active
          ? 'bg-[#e31937] text-white'
          : 'bg-[#1a1a1a] text-[#9ca3af] border border-[#2a2a2a]'
      }`}
      title={indicator.title}
    >
      <span className="flex items-center gap-1.5 text-sm font-medium leading-tight">
        <span
          aria-hidden="true"
          className={`inline-block w-1.5 h-1.5 rounded-full ${indicator.dotClass} ${
            indicator.pulse ? 'animate-pulse' : ''
          }`}
        />
        <span className="truncate">{label}</span>
      </span>
      {battery && (
        <span
          className={`text-[10px] tabular-nums leading-tight mt-0.5 ${
            active ? 'text-white/85' : 'text-[#6b7280]'
          }`}
        >
          {battery}
        </span>
      )}
    </button>
  );
}

interface Indicator {
  dotClass: string;
  pulse: boolean;
  title: string;
}

function stateIndicator(
  status: VehicleStatus | undefined,
  t: (key: string) => string,
): Indicator {
  if (!status) {
    return { dotClass: 'bg-[#3a3a3a]', pulse: false, title: t('carSelector.state.unknown') };
  }

  const raw = (status.state ?? '').toLowerCase();
  const charging =
    raw === 'charging' ||
    (status.chargingState ?? '').toLowerCase() === 'charging' ||
    status.chargerPower != null && status.chargerPower > 0;

  if (charging) {
    return { dotClass: 'bg-[#3b82f6]', pulse: true, title: t('carSelector.state.charging') };
  }
  if (raw === 'driving' || (status.shiftState ?? '').toLowerCase() === 'd' ||
      (status.shiftState ?? '').toLowerCase() === 'r') {
    return { dotClass: 'bg-[#22c55e]', pulse: true, title: t('carSelector.state.driving') };
  }
  if (raw === 'asleep') {
    return { dotClass: 'bg-[#6b7280]', pulse: false, title: t('carSelector.state.asleep') };
  }
  if (raw === 'offline') {
    return { dotClass: 'bg-[#ef4444]', pulse: false, title: t('carSelector.state.offline') };
  }
  if (raw === 'online' || raw === 'parked' || raw === '') {
    return { dotClass: 'bg-[#9ca3af]', pulse: false, title: t('carSelector.state.parked') };
  }
  return { dotClass: 'bg-[#9ca3af]', pulse: false, title: status.state ?? '' };
}

function formatBattery(
  status: VehicleStatus | undefined,
  u: ReturnType<typeof useUnits>,
): string | null {
  if (!status) return null;
  const pct = status.usableBatteryLevel ?? status.batteryLevel;
  // Prefer the live estimated range (varies with temperature/load), fall
  // back to the rated range from the DB so we always show something useful.
  const rangeKm = status.estBatteryRangeKm ?? status.ratedBatteryRangeKm ?? status.idealBatteryRangeKm;
  const parts: string[] = [];
  if (pct != null) parts.push(`${Math.round(pct)}%`);
  if (rangeKm != null) {
    const v = u.convertDistance(rangeKm);
    if (v != null) parts.push(`${Math.round(v)} ${u.distanceUnit}`);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}
