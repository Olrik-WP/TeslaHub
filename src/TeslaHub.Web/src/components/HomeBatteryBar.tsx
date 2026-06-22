import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUnits } from '../hooks/useUnits';
import {
  useControlAvailability,
  useControlMutation,
  type OptimisticPatch,
} from '../hooks/useVehicleControl';
import type { VehicleStatus } from '../api/queries';

interface Props {
  vehicle: VehicleStatus;
  /** True while a charge session is active. Drives the soft pulse and
   *  the optional "+ kWh added" suffix. */
  isCharging: boolean;
}

// Tesla allows the charge limit between 50% and 100% on every model we
// support. VehicleStatus (TeslaMate-fed) doesn't carry the per-car
// min/max the Fleet snapshot does, so we use the universal bounds here.
const MIN_LIMIT = 50;
const MAX_LIMIT = 100;
// Tesla's own UI snaps the charge limit to 5% increments — mirror that
// so dragging lands on the same values the car actually accepts.
const LIMIT_STEP = 5;

function snapLimit(value: number): number {
  const snapped = Math.round(value / LIMIT_STEP) * LIMIT_STEP;
  return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, snapped));
}

/** Optimistic patch against the TeslaMate-fed ['vehicle', carId] cache so
 *  the marker snaps to the new limit instantly — Tesla's command reply
 *  never echoes state and TeslaMate's MQTT cache lags 30-60s. */
function vehiclePatch<TBody = void>(
  carId: number | undefined,
  update: (prev: VehicleStatus, body: TBody) => Partial<VehicleStatus>,
): OptimisticPatch<TBody, VehicleStatus> | undefined {
  if (!carId) return undefined;
  return {
    queryKey: ['vehicle', carId],
    update: (prev, body) => (prev ? { ...prev, ...update(prev, body) } : prev),
  };
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
 * The charge-limit marker is colour-coded (amber) and, when Fleet control
 * is available for this car, draggable: dragging it (or arrow keys when
 * focused) sets the Tesla charge limit via the same `charge/limit`
 * command the Control page uses, debounced 500ms so we don't hammer
 * Tesla while the user slides.
 */
export default function HomeBatteryBar({ vehicle, isCharging }: Props) {
  const { t } = useTranslation();
  const u = useUnits();

  const soc = vehicle.usableBatteryLevel ?? vehicle.batteryLevel;
  const rangeKm = vehicle.ratedBatteryRangeKm ?? vehicle.estBatteryRangeKm;
  const powerKw = vehicle.chargerPower;
  const energyAdded = vehicle.chargeEnergyAdded;
  const serverLimit = vehicle.chargeLimitSoc;
  const carId = vehicle.carId;

  // Map this TeslaMate car to its Fleet vehicleId by VIN so we can send
  // the set-charge-limit command. Prefer the paired entry if the same
  // VIN appears under two Tesla accounts.
  const { data: availability } = useControlAvailability();
  const teslaVehicle = useMemo(() => {
    if (!availability?.vehicles?.length || !vehicle.vin) return undefined;
    const matches = availability.vehicles.filter((v) => v.vin === vehicle.vin);
    if (matches.length === 0) return undefined;
    return matches.find((v) => v.keyPaired) ?? matches[0];
  }, [availability, vehicle.vin]);
  const vehicleId = teslaVehicle?.id;
  const canEdit = !!vehicleId && !!availability?.connected && !!teslaVehicle?.keyPaired;

  const setLimitMut = useControlMutation<{ percent: number }>(vehicleId, 'charge/limit', {
    silent: true,
    optimistic: vehiclePatch<{ percent: number }>(carId, (_prev, body) => ({
      chargeLimitSoc: body.percent,
    })),
  });

  // Local limit drives the marker position live while dragging. Synced
  // from the server value whenever it changes, and pushed back (debounced)
  // when the user moves it.
  const [localLimit, setLocalLimit] = useState<number | null>(serverLimit);
  useEffect(() => {
    setLocalLimit(serverLimit);
  }, [serverLimit]);

  const limitTimer = useRef<number | null>(null);
  useEffect(() => {
    if (!canEdit || localLimit == null || serverLimit == null) return;
    if (localLimit === serverLimit) return;
    if (limitTimer.current) window.clearTimeout(limitTimer.current);
    const value = localLimit;
    limitTimer.current = window.setTimeout(() => setLimitMut.mutate({ percent: value }), 500);
    return () => {
      if (limitTimer.current) window.clearTimeout(limitTimer.current);
    };
  }, [localLimit]); // eslint-disable-line react-hooks/exhaustive-deps

  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const [dragging, setDragging] = useState(false);

  const pctFromClientX = (clientX: number): number => {
    const el = trackRef.current;
    if (!el) return localLimit ?? MIN_LIMIT;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0) return localLimit ?? MIN_LIMIT;
    const pct = ((clientX - rect.left) / rect.width) * 100;
    return snapLimit(pct);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!canEdit) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // setPointerCapture can throw on detached nodes — drag still works
      // via the move/up handlers, so ignore.
    }
    draggingRef.current = true;
    setDragging(true);
    setLocalLimit(pctFromClientX(e.clientX));
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    setLocalLimit(pctFromClientX(e.clientX));
  };
  const endDrag = (e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setDragging(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore — pointer may already be released
    }
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!canEdit) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault();
      setLocalLimit((v) => snapLimit((v ?? MIN_LIMIT) - LIMIT_STEP));
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault();
      setLocalLimit((v) => snapLimit((v ?? MIN_LIMIT) + LIMIT_STEP));
    }
  };

  if (soc == null) {
    return (
      <div className="px-3 sm:px-4 pt-2 pb-3 text-[#6b7280] text-xs text-center">
        {t('home.batteryBar.noData')}
      </div>
    );
  }

  const socColor = socBandColor(soc);
  const rangeUserUnit = rangeKm != null ? Math.round(u.convertDistance(rangeKm) ?? 0) : null;
  const displayLimit =
    localLimit != null && localLimit > 0 && localLimit <= 100 ? localLimit : null;

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
        {isCharging && powerKw != null && powerKw > 0 ? (
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
        ) : (
          displayLimit != null && (
            <div className="flex items-center gap-1.5 text-xs sm:text-sm tabular-nums">
              <span className="w-1 h-3 rounded-full bg-[#fbbf24]" />
              <span className="text-[#9ca3af]">
                {t('home.batteryBar.chargeLimit')}{' '}
                <span className="text-[#fbbf24] font-semibold">{displayLimit}%</span>
              </span>
            </div>
          )
        )}
      </div>
      <div className="mt-2 relative">
        <div
          ref={trackRef}
          className="relative h-1.5 sm:h-2 rounded-full bg-[#1f1f1f] overflow-hidden"
        >
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
        </div>
        {displayLimit != null && (
          <div
            role={canEdit ? 'slider' : undefined}
            aria-label={canEdit ? t('home.batteryBar.chargeLimit') : undefined}
            aria-valuemin={canEdit ? MIN_LIMIT : undefined}
            aria-valuemax={canEdit ? MAX_LIMIT : undefined}
            aria-valuenow={canEdit ? displayLimit : undefined}
            tabIndex={canEdit ? 0 : -1}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onKeyDown={onKeyDown}
            title={`${t('home.batteryBar.chargeLimit')}: ${displayLimit}%`}
            className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 z-10 outline-none ${
              canEdit ? 'cursor-grab active:cursor-grabbing touch-none' : 'pointer-events-none'
            }`}
            style={{ left: `${displayLimit}%` }}
          >
            {/* Generous transparent hit area for touch (28px) */}
            {canEdit && (
              <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-7 h-7" />
            )}
            {/* Visible amber marker */}
            <span
              className={`relative block rounded-full bg-[#fbbf24] ring-1 ring-black/40 transition-all ${
                dragging ? 'w-1.5 h-5 shadow-[0_0_10px_#fbbf24]' : 'w-1 h-3.5 shadow-[0_0_6px_#fbbf24cc]'
              }`}
            />
            {/* Floating value while dragging */}
            {dragging && (
              <span className="absolute bottom-full mb-1.5 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded bg-[#1f1f1f] border border-[#fbbf24]/50 text-[#fbbf24] text-[10px] font-semibold tabular-nums whitespace-nowrap">
                {displayLimit}%
              </span>
            )}
          </div>
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
