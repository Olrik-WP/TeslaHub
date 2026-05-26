import { useTranslation } from 'react-i18next';
import type { Car, VehicleStatus } from '../api/queries';
import { useVehicleStatus } from '../hooks/useVehicle';
import { useUnits } from '../hooks/useUnits';
import {
  useVehicleAccentColor,
  accentTextColor,
} from '../hooks/useVehicleAccentColor';

interface Props {
  cars: Car[];
  selectedId: number | undefined;
  onChange: (id: number) => void;
}

/**
 * Top-of-app horizontal vehicle switcher, drawn as colour-coded pills
 * (one per car). Replaces the earlier `CarSelector`.
 *
 * Key behaviours:
 *   - Renders nothing when the user has a single car (no UI to clutter
 *     the header when there's nothing to switch between).
 *   - Active pill carries the vehicle's accent colour as a filled
 *     background; foreground text colour auto-picked for contrast.
 *   - Inactive pills stay neutral dark, but their state dot reuses
 *     the vehicle's accent colour as a recognizable identity marker
 *     when the car is idle (so you can still tell which is which at
 *     a glance).
 *   - State dot overrides the accent dot when the car is driving /
 *     charging / asleep / offline — the live state is more important
 *     than the visual identity in those moments.
 *   - Horizontally scrollable on overflow (3+ cars on a narrow phone).
 */
export default function VehicleSwitcherPills({ cars, selectedId, onChange }: Props) {
  if (cars.length <= 1) return null;

  return (
    <div className="flex gap-2 px-4 py-2 overflow-x-auto">
      {cars.map((car) => (
        <VehiclePill
          key={car.id}
          car={car}
          active={selectedId === car.id}
          onClick={() => onChange(car.id)}
        />
      ))}
    </div>
  );
}

interface PillProps {
  car: Car;
  active: boolean;
  onClick: () => void;
}

function VehiclePill({ car, active, onClick }: PillProps) {
  const { t } = useTranslation();
  const u = useUnits();
  // Reuses the existing per-car query — deduped with the polling
  // Home/Map already does for the active car (zero extra request).
  const { data: status } = useVehicleStatus(car.id);
  const accent = useVehicleAccentColor(car.id, status);

  const label = car.name || car.marketingName || car.model || `Car ${car.id}`;
  const indicator = stateIndicator(status, t);
  const battery = formatBattery(status, u);

  // Inline style — Tailwind can't safelist arbitrary hex from runtime
  // data without JIT entries, so we apply the accent colour directly.
  const activeStyle: React.CSSProperties = active
    ? {
        backgroundColor: accent.hex,
        borderColor: accent.hex,
        color: accentTextColor(accent.hex),
      }
    : {};

  // Show the accent colour as the dot ONLY when the car is in a
  // neutral state (parked / online). For live states (driving,
  // charging, asleep, offline) the indicator's own colour conveys
  // more useful info — we don't overwrite it.
  const showAccentDot = !active
    && accent.source !== 'default'
    && (indicator.dotClass === 'bg-[#9ca3af]' || indicator.dotClass === 'bg-[#3a3a3a]');

  const dotStyle: React.CSSProperties = showAccentDot
    ? { backgroundColor: accent.hex }
    : {};

  return (
    <button
      type="button"
      onClick={onClick}
      style={activeStyle}
      className={`flex-shrink-0 inline-flex items-center gap-2 rounded-full px-3 py-1.5 min-h-[40px] whitespace-nowrap border transition-colors duration-150 ${
        active
          ? 'shadow-sm'
          : 'bg-[#1a1a1a] border-[#2a2a2a] text-[#9ca3af]'
      }`}
      title={indicator.title}
      aria-pressed={active}
    >
      <span
        aria-hidden="true"
        style={dotStyle}
        className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${
          showAccentDot ? '' : indicator.dotClass
        } ${indicator.pulse ? 'animate-pulse' : ''}`}
      />
      <span className="text-sm font-medium leading-tight">{label}</span>
      {battery && (
        <span
          className={`text-[10px] tabular-nums leading-tight ${
            active ? 'opacity-85' : 'text-[#6b7280]'
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

// Same logic as the prior CarSelector — kept inline because the
// shape of Tesla's state strings evolves slowly and a single source
// here is enough. Lift to `src/utils/vehicleState.ts` if a third
// caller appears.
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
    (status.chargerPower != null && status.chargerPower > 0);
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
  // Prefer the live estimated range (varies with temperature/load),
  // fall back to the rated range from the DB so we always show
  // something useful even when the car has been offline a while.
  const rangeKm = status.estBatteryRangeKm ?? status.ratedBatteryRangeKm ?? status.idealBatteryRangeKm;
  const parts: string[] = [];
  if (pct != null) parts.push(`${Math.round(pct)}%`);
  if (rangeKm != null) {
    const v = u.convertDistance(rangeKm);
    if (v != null) parts.push(`${Math.round(v)} ${u.distanceUnit}`);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}
