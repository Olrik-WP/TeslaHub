import { useEffect, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import ControlCard from './ControlCard';
import ControlButton from './ControlButton';
import { useControlMutation, type VehicleCapabilities, type VehicleStateSnapshot } from '../../hooks/useVehicleControl';
import type { VehicleStatus } from '../../api/queries';
import { readCharge } from './stateParsers';

interface Props {
  vehicleId: number;
  snapshot: VehicleStateSnapshot | undefined;
  vehicleStatus?: VehicleStatus;
  capabilities: VehicleCapabilities;
  online: boolean;
}

const ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" />
  </svg>
);

/**
 * Charging controls. Sliders are debounced (500ms) before sending the
 * command — Tesla rate-limits us to 30 cmd/min/vehicle.
 */
export default function ChargeCard({ vehicleId, snapshot, vehicleStatus, capabilities, online }: Props) {
  const { t } = useTranslation();
  const charge = readCharge(snapshot, vehicleStatus);

  const isCharging = (charge.charging_state ?? '').toLowerCase() === 'charging';
  const chargingStateLower = (charge.charging_state ?? '').toLowerCase();
  // "disconnected" or empty/unknown means not plugged. Tesla also
  // returns "Stopped" / "Complete" / "Charging" / "NoPower" when a
  // cable is connected — all those count as plugged.
  const isPlugged = !!charge.charging_state
    && chargingStateLower !== 'disconnected'
    && chargingStateLower !== 'unknown';
  const limitServer = charge.charge_limit_soc ?? 80;
  const ampsServer = charge.charge_amps ?? charge.charge_current_request ?? 16;
  const maxAmps = charge.charge_current_request_max ?? 32;

  const [limit, setLimit] = useState(limitServer);
  const [amps, setAmps] = useState(ampsServer);
  useEffect(() => { setLimit(limitServer); }, [limitServer]);
  useEffect(() => { setAmps(ampsServer); }, [ampsServer]);

  const startStop = useControlMutation(vehicleId, isCharging ? 'charge/stop' : 'charge/start');
  const setLimitMut = useControlMutation<{ percent: number }>(vehicleId, 'charge/limit');
  const setAmpsMut = useControlMutation<{ amps: number }>(vehicleId, 'charge/amps');
  const portDoor = useControlMutation<{ on: boolean }>(vehicleId, 'charge/port-door');

  // Debounced send to avoid hammering Tesla while user drags.
  const limitTimer = useRef<number | null>(null);
  const ampsTimer = useRef<number | null>(null);
  useEffect(() => {
    if (limit === limitServer) return;
    if (limitTimer.current) window.clearTimeout(limitTimer.current);
    limitTimer.current = window.setTimeout(() => setLimitMut.mutate({ percent: limit }), 500);
    return () => { if (limitTimer.current) window.clearTimeout(limitTimer.current); };
  }, [limit]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (amps === ampsServer) return;
    if (ampsTimer.current) window.clearTimeout(ampsTimer.current);
    ampsTimer.current = window.setTimeout(() => setAmpsMut.mutate({ amps }), 500);
    return () => { if (ampsTimer.current) window.clearTimeout(ampsTimer.current); };
  }, [amps]); // eslint-disable-line react-hooks/exhaustive-deps

  const stateBadge = (
    <span className={[
      'text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full border',
      isCharging
        ? 'border-[#22c55e]/40 text-[#22c55e] bg-[#22c55e]/10'
        : isPlugged
          ? 'border-[#3b82f6]/40 text-[#3b82f6] bg-[#3b82f6]/10'
          : 'border-[#2a2a2a] text-[#6b7280]',
    ].join(' ')}>
      {isCharging ? t('control.charge.charging') : isPlugged ? t('control.charge.plugged') : t('control.charge.disconnected')}
    </span>
  );

  return (
    <ControlCard title={t('control.charge.title')} icon={ICON} badge={stateBadge}>
      {/* Battery + power read-out */}
      <div className="flex items-baseline justify-between text-sm text-[#e0e0e0] mb-3">
        <span>
          {charge.battery_level != null ? `${charge.battery_level}%` : '—'}
          {charge.battery_range != null && (
            <span className="text-[#6b7280] text-xs ml-2">{Math.round(charge.battery_range)} km</span>
          )}
        </span>
        {isCharging && charge.charger_power != null && (
          <span className="text-xs text-[#22c55e]">+{charge.charger_power.toFixed(1)} kW</span>
        )}
      </div>

      {/* Limit slider */}
      <div className="mb-3">
        <div className="flex justify-between text-[11px] text-[#9ca3af] mb-1">
          <span>{t('control.charge.limit')}</span>
          <span>{limit}%</span>
        </div>
        <input
          type="range"
          min={charge.charge_limit_soc_min ?? 50}
          max={charge.charge_limit_soc_max ?? 100}
          value={limit}
          disabled={!online}
          onChange={(e) => setLimit(Number(e.target.value))}
          className="w-full accent-[#e31937]"
        />
      </div>

      {/* Amps slider — only when plugged */}
      {isPlugged && (
        <div className="mb-3">
          <div className="flex justify-between text-[11px] text-[#9ca3af] mb-1">
            <span>{t('control.charge.amps')}</span>
            <span>{amps} A</span>
          </div>
          <input
            type="range"
            min={1}
            max={maxAmps}
            value={amps}
            disabled={!online}
            onChange={(e) => setAmps(Number(e.target.value))}
            className="w-full accent-[#e31937]"
          />
        </div>
      )}

      {/* Action buttons */}
      <div className={`grid ${capabilities.motorizedChargePort ? 'grid-cols-2' : 'grid-cols-1'} gap-2`}>
        <ControlButton
          label={isCharging ? t('control.charge.stop') : t('control.charge.start')}
          onClick={() => startStop.mutate(undefined as never)}
          state={isCharging ? 'on' : 'neutral'}
          loading={startStop.isPending}
          wakingHint={startStop.wakingHint}
          disabled={!online || !isPlugged}
          icon={<BoltIcon />}
        />
        {capabilities.motorizedChargePort && (
          <ControlButton
            label={
              isPlugged
                ? t('control.charge.unlockCable')
                : charge.charge_port_door_open
                  ? t('control.charge.closePort')
                  : t('control.charge.openPort')
            }
            onClick={() => portDoor.mutate({ on: isPlugged ? true : !charge.charge_port_door_open })}
            state={isPlugged ? 'info' : charge.charge_port_door_open ? 'warning' : 'neutral'}
            loading={portDoor.isPending}
            wakingHint={portDoor.wakingHint}
            disabled={!online}
            icon={<PortIcon />}
            title={isPlugged ? t('control.charge.unlockCableHint') : undefined}
          />
        )}
      </div>
    </ControlCard>
  );
}

function BoltIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" />
    </svg>
  );
}

function PortIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="6" width="16" height="12" rx="2" />
      <path d="M8 12h8" />
    </svg>
  );
}
