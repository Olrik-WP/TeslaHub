import { useTranslation } from 'react-i18next';
import { useUnits } from '../hooks/useUnits';
import type { VehicleStatus } from '../api/queries';

interface Props {
  vehicle: VehicleStatus;
  /** True while a charge session is active. Drives the soft pulse and
   *  the optional "+ kWh added" suffix. */
  isCharging: boolean;
}

/**
 * Horizontal battery bar that sits directly under the 3D hero car —
 * deliberately minimal so the car itself stays the focal point. Shows:
 *
 *   - Battery percentage (large), with colour matching the SOC band.
 *   - Remaining rated range in user units.
 *   - Live charger power (only while charging).
 *   - A 6px-tall progress bar with a chargeLimitSoc tick marker.
 *
 * No card chrome, no border — it visually belongs to the hero block
 * above. The bar pulses softly while charging so the user gets the
 * "alive" signal without an extra overlay.
 */
export default function HomeBatteryBar({ vehicle, isCharging }: Props) {
  const { t } = useTranslation();
  const u = useUnits();

  const soc = vehicle.usableBatteryLevel ?? vehicle.batteryLevel;
  const limit = vehicle.chargeLimitSoc;
  const rangeKm = vehicle.ratedBatteryRangeKm ?? vehicle.estBatteryRangeKm;
  const powerKw = vehicle.chargerPower;
  const energyAdded = vehicle.chargeEnergyAdded;

  if (soc == null) {
    return (
      <div className="px-3 sm:px-4 pt-2 pb-3 text-[#6b7280] text-xs text-center">
        {t('home.batteryBar.noData')}
      </div>
    );
  }

  const socColor = socBandColor(soc);
  const rangeUserUnit = rangeKm != null ? Math.round(u.convertDistance(rangeKm) ?? 0) : null;

  return (
    <div className="px-3 sm:px-4 pt-1.5 pb-3 select-none">
      <div className="flex items-end justify-between gap-3">
        <div className="flex items-baseline gap-1">
          <span
            className="text-2xl sm:text-3xl font-bold tabular-nums"
            style={{ color: socColor }}
          >
            {Math.round(soc)}
          </span>
          <span className="text-sm text-[#9ca3af]">%</span>
          {rangeUserUnit != null && (
            <span className="ml-2 text-xs sm:text-sm text-[#9ca3af] tabular-nums">
              · {rangeUserUnit} {u.distanceUnit}
            </span>
          )}
        </div>
        {isCharging && powerKw != null && powerKw > 0 && (
          <div className="flex items-center gap-1.5 text-[#3b82f6] text-xs sm:text-sm">
            <span className="w-1.5 h-1.5 rounded-full bg-[#3b82f6] animate-pulse" />
            <span className="font-semibold tabular-nums">
              +{powerKw.toFixed(1)} kW
            </span>
            {energyAdded != null && energyAdded > 0 && (
              <span className="text-[#9ca3af] tabular-nums hidden sm:inline">
                · +{energyAdded.toFixed(1)} kWh
              </span>
            )}
          </div>
        )}
      </div>
      <div className="mt-2 relative h-1.5 sm:h-2 rounded-full bg-[#1f1f1f] overflow-hidden">
        <div
          className={`absolute inset-y-0 left-0 rounded-full transition-all duration-700 ${
            isCharging ? 'animate-pulse' : ''
          }`}
          style={{
            width: `${Math.max(0, Math.min(100, soc))}%`,
            background: isCharging
              ? `linear-gradient(90deg, ${socColor}, #3b82f6)`
              : socColor,
            boxShadow: `0 0 8px ${socColor}55`,
          }}
        />
        {limit != null && limit > 0 && limit <= 100 && (
          <div
            className="absolute top-1/2 -translate-y-1/2 w-0.5 h-3 bg-white/70 rounded-sm"
            style={{ left: `${limit}%`, transform: `translate(-50%, -50%)` }}
            title={`${t('home.batteryBar.chargeLimit')}: ${limit}%`}
          />
        )}
      </div>
    </div>
  );
}

/**
 * Standard Tesla-style colour bands: red below 10, orange below 20,
 * yellow below 50, green otherwise. Matches the colour logic in
 * BatteryGauge for visual consistency between the old PNG fallback
 * and the new bar.
 */
function socBandColor(soc: number): string {
  if (soc < 10) return '#ef4444';
  if (soc < 20) return '#f59e0b';
  if (soc < 50) return '#eab308';
  return '#22c55e';
}
