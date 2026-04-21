import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ControlCard from './ControlCard';
import ControlButton from './ControlButton';
import SeatHeaterRow from './SeatHeaterRow';
import { capabilitiesLoaded, useControlMutation, type VehicleCapabilities, type VehicleStateSnapshot } from '../../hooks/useVehicleControl';
import type { VehicleStatus } from '../../api/queries';
import { copTempToInt, keeperModeToInt, readClimate } from './stateParsers';

interface Props {
  vehicleId: number;
  snapshot: VehicleStateSnapshot | undefined;
  vehicleStatus?: VehicleStatus;
  capabilities: VehicleCapabilities;
  online: boolean;
}

const STEP = 0.5;
const MIN_TEMP_DEFAULT = 15;
const MAX_TEMP_DEFAULT = 28;

const ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2v20M2 12h20M5 5l14 14M19 5L5 19" />
  </svg>
);

/**
 * Main "Climate" card. Far richer than the official Tesla app's 4-button
 * shortcut: full temperature stepper, dual-zone, seat heaters per
 * available seat (filtered by capabilities), keeper mode, COP, etc.
 */
export default function ClimateCard({ vehicleId, snapshot, vehicleStatus, capabilities, online }: Props) {
  const { t } = useTranslation();
  const climate = readClimate(snapshot, vehicleStatus);

  const isOn = climate.is_climate_on ?? climate.is_auto_conditioning_on ?? false;
  const driverServer = climate.driver_temp_setting ?? 22;
  const passengerServer = climate.passenger_temp_setting ?? driverServer;

  // Local optimistic state for the temperature stepper. Snaps back to
  // server-side value whenever the snapshot updates.
  const [driver, setDriver] = useState(driverServer);
  const [passenger, setPassenger] = useState(passengerServer);
  const [sync, setSync] = useState(driverServer === passengerServer);

  useEffect(() => { setDriver(driverServer); }, [driverServer]);
  useEffect(() => { setPassenger(passengerServer); }, [passengerServer]);
  useEffect(() => { setSync(driverServer === passengerServer); }, [driverServer, passengerServer]);

  const min = climate.min_avail_temp ?? MIN_TEMP_DEFAULT;
  const max = climate.max_avail_temp ?? MAX_TEMP_DEFAULT;

  const startStop = useControlMutation(vehicleId, isOn ? 'climate/stop' : 'climate/start');
  const setTemps = useControlMutation<{ driverTemp: number; passengerTemp: number }>(vehicleId, 'climate/temps', { silent: true });
  const precondition = useControlMutation<{ on: boolean }>(vehicleId, 'climate/precondition');
  const steeringWheel = useControlMutation<{ on: boolean }>(vehicleId, 'climate/steering-wheel-heater');
  const keeper = useControlMutation<{ mode: number }>(vehicleId, 'climate/keeper');
  const copToggle = useControlMutation<{ on: boolean; fanOnly: boolean }>(vehicleId, 'climate/cabin-overheat');
  const copTemp = useControlMutation<{ level: number }>(vehicleId, 'climate/cabin-overheat-temp');
  const bioweapon = useControlMutation<{ on: boolean }>(vehicleId, 'climate/bioweapon');

  const adjustDriver = (delta: number) => {
    const next = Math.max(min, Math.min(max, +(driver + delta).toFixed(1)));
    setDriver(next);
    const passengerNext = sync ? next : passenger;
    setPassenger(passengerNext);
    setTemps.mutate({ driverTemp: next, passengerTemp: passengerNext });
  };
  const adjustPassenger = (delta: number) => {
    const next = Math.max(min, Math.min(max, +(passenger + delta).toFixed(1)));
    setPassenger(next);
    setTemps.mutate({ driverTemp: driver, passengerTemp: next });
  };

  const keeperInt = keeperModeToInt(climate.climate_keeper_mode);
  const isPreconditioning = climate.is_preconditioning ?? false;
  const steeringHot = climate.steering_wheel_heater ?? false;
  const copOn = (climate.cabin_overheat_protection ?? 'Off').toLowerCase() !== 'off';
  const copFanOnly = (climate.cabin_overheat_protection ?? '').toLowerCase().includes('no');
  const copLevel = copTempToInt(climate.cop_activation_temperature);

  return (
    <ControlCard title={t('control.climate.title')} icon={ICON}>
      {/* Big central temperature stepper */}
      <div className="grid grid-cols-3 items-center gap-2 my-2">
        <button
          type="button"
          onClick={() => adjustDriver(-STEP)}
          disabled={setTemps.isPending}
          className="h-14 rounded-xl bg-[#1a1a1a] border border-[#2a2a2a] text-[#e0e0e0] text-2xl active:bg-[#222] disabled:opacity-50"
        >−</button>
        <div className="flex flex-col items-center">
          <span className="text-3xl font-semibold text-[#e0e0e0]">{driver.toFixed(1)}°</span>
          <span className="text-[10px] text-[#6b7280] uppercase tracking-wide">
            {t('control.climate.driver')}
          </span>
        </div>
        <button
          type="button"
          onClick={() => adjustDriver(+STEP)}
          disabled={setTemps.isPending}
          className="h-14 rounded-xl bg-[#1a1a1a] border border-[#2a2a2a] text-[#e0e0e0] text-2xl active:bg-[#222] disabled:opacity-50"
        >+</button>
      </div>

      {/* ON/OFF */}
      <div className="my-3">
        <ControlButton
          label={isOn ? t('control.climate.stop') : t('control.climate.start')}
          onClick={() => startStop.mutate(undefined as never)}
          state={isOn ? 'on' : 'off'}
          loading={startStop.isPending}
          wakingHint={startStop.wakingHint}
          disabled={false}
          fullWidth
          size="lg"
          icon={isOn ? <PowerIcon /> : <PowerIcon off />}
        />
      </div>

      {/* Dual-zone passenger row + sync */}
      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-[#2a2a2a]">
        <button
          type="button"
          onClick={() => setSync((s) => !s)}
          className={[
            'flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border',
            sync ? 'border-[#22c55e]/40 text-[#22c55e]' : 'border-[#2a2a2a] text-[#9ca3af]',
          ].join(' ')}
        >
          {sync ? '⇆ ' : ''}{t('control.climate.sync')}
        </button>
        <div className="flex-1 grid grid-cols-3 items-center gap-2">
          <button
            type="button"
            onClick={() => adjustPassenger(-STEP)}
            disabled={sync || setTemps.isPending}
            className="h-9 rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] text-[#9ca3af] text-base active:bg-[#222] disabled:opacity-40"
          >−</button>
          <div className="flex flex-col items-center">
            <span className="text-base font-medium text-[#e0e0e0]">{passenger.toFixed(1)}°</span>
            <span className="text-[10px] text-[#6b7280] uppercase">{t('control.climate.passenger')}</span>
          </div>
          <button
            type="button"
            onClick={() => adjustPassenger(+STEP)}
            disabled={sync || setTemps.isPending}
            className="h-9 rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] text-[#9ca3af] text-base active:bg-[#222] disabled:opacity-40"
          >+</button>
        </div>
      </div>

      {/* Inside / outside temperature read-out */}
      {(climate.inside_temp != null || climate.outside_temp != null) && (
        <div className="flex justify-between text-[11px] text-[#6b7280] mt-3 pt-3 border-t border-[#2a2a2a]">
          {climate.inside_temp != null && (
            <span>{t('control.climate.inside')}: {climate.inside_temp.toFixed(1)}°</span>
          )}
          {climate.outside_temp != null && (
            <span>{t('control.climate.outside')}: {climate.outside_temp.toFixed(1)}°</span>
          )}
        </div>
      )}

      {/* Quick modes */}
      <div className="grid grid-cols-3 gap-2 mt-3">
        <ControlButton
          label={t('control.climate.precondition')}
          onClick={() => precondition.mutate({ on: !isPreconditioning })}
          state={isPreconditioning ? 'warning' : 'neutral'}
          loading={precondition.isPending}
          wakingHint={precondition.wakingHint}
          disabled={false}
          icon={<FlameIcon />}
        />
        <ControlButton
          label={t('control.climate.steeringWheel')}
          onClick={() => steeringWheel.mutate({ on: !steeringHot })}
          state={steeringHot ? 'warning' : 'neutral'}
          loading={steeringWheel.isPending}
          wakingHint={steeringWheel.wakingHint}
          disabled={false}
          icon={<WheelIcon />}
        />
        <ControlButton
          label={t('control.climate.bioweapon')}
          onClick={() => bioweapon.mutate({ on: !(climate.bioweapon_mode ?? false) })}
          state={climate.bioweapon_mode ? 'info' : 'neutral'}
          loading={bioweapon.isPending}
          wakingHint={bioweapon.wakingHint}
          disabled={climate.bioweapon_mode == null}
          icon={<ShieldIcon />}
          title={t('control.climate.bioweaponHint')}
        />
      </div>

      {/* Seat heaters. Front pair always shown — every Tesla has them.
          Rear seats: shown by default (every modern Tesla has them);
          only hidden if vehicle_config explicitly says rear_seat_heaters=0.
          Third row: hidden by default (rare Model X/S 7-seater option). */}
      {(() => {
        const capsKnown = capabilitiesLoaded(capabilities);
        const showRear = !capsKnown || capabilities.hasRearSeatHeaters;
        const showThirdRow = capsKnown && capabilities.hasThirdRow;
        return (
      <div className="mt-3 pt-3 border-t border-[#2a2a2a] space-y-2">
        <p className="text-[11px] text-[#6b7280] uppercase tracking-wide">{t('control.climate.seatHeaters')}</p>
        <SeatHeaterRow vehicleId={vehicleId} position={0} currentLevel={climate.seat_heater_left} label={t('control.climate.seat.frontLeft')} />
        <SeatHeaterRow vehicleId={vehicleId} position={1} currentLevel={climate.seat_heater_right} label={t('control.climate.seat.frontRight')} />
        {showRear && (
          <>
            <SeatHeaterRow vehicleId={vehicleId} position={2} currentLevel={climate.seat_heater_rear_left} label={t('control.climate.seat.rearLeft')} />
            <SeatHeaterRow vehicleId={vehicleId} position={4} currentLevel={climate.seat_heater_rear_center} label={t('control.climate.seat.rearCenter')} />
            <SeatHeaterRow vehicleId={vehicleId} position={5} currentLevel={climate.seat_heater_rear_right} label={t('control.climate.seat.rearRight')} />
          </>
        )}
        {showThirdRow && (
          <>
            <SeatHeaterRow vehicleId={vehicleId} position={7} currentLevel={climate.seat_heater_third_row_left} label={t('control.climate.seat.thirdRowLeft')} />
            <SeatHeaterRow vehicleId={vehicleId} position={8} currentLevel={climate.seat_heater_third_row_right} label={t('control.climate.seat.thirdRowRight')} />
          </>
        )}
      </div>
        );
      })()}

      {/* Keeper mode */}
      <div className="mt-3 pt-3 border-t border-[#2a2a2a]">
        <p className="text-[11px] text-[#6b7280] uppercase tracking-wide mb-2">{t('control.climate.keeperMode')}</p>
        <div className="grid grid-cols-4 gap-2">
          {[0, 1, 2, 3].map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => keeper.mutate({ mode })}
              disabled={keeper.isPending}
              className={[
                'py-2 rounded-lg border text-[11px]',
                mode === keeperInt
                  ? 'bg-[#3b82f6]/15 border-[#3b82f6]/40 text-[#3b82f6]'
                  : 'bg-[#1a1a1a] border-[#2a2a2a] text-[#9ca3af]',
              ].join(' ')}
            >
              {t(`control.climate.keeper.${['off', 'on', 'dog', 'camp'][mode]}`)}
            </button>
          ))}
        </div>
      </div>

      {/* Cabin overheat protection */}
      <div className="mt-3 pt-3 border-t border-[#2a2a2a]">
        <p className="text-[11px] text-[#6b7280] uppercase tracking-wide mb-2">{t('control.climate.copTitle')}</p>
        <div className="grid grid-cols-3 gap-2 mb-2">
          {[
            { label: t('control.climate.cop.off'), on: false, fanOnly: false, active: !copOn },
            { label: t('control.climate.cop.fanOnly'), on: true, fanOnly: true, active: copOn && copFanOnly },
            { label: t('control.climate.cop.on'), on: true, fanOnly: false, active: copOn && !copFanOnly },
          ].map((opt) => (
            <button
              key={opt.label}
              type="button"
              onClick={() => copToggle.mutate({ on: opt.on, fanOnly: opt.fanOnly })}
              disabled={copToggle.isPending}
              className={[
                'py-2 rounded-lg border text-[11px]',
                opt.active
                  ? 'bg-[#22c55e]/15 border-[#22c55e]/40 text-[#22c55e]'
                  : 'bg-[#1a1a1a] border-[#2a2a2a] text-[#9ca3af]',
              ].join(' ')}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: '30°C', level: 0 },
            { label: '35°C', level: 1 },
            { label: '40°C', level: 2 },
          ].map((opt) => (
            <button
              key={opt.level}
              type="button"
              onClick={() => copTemp.mutate({ level: opt.level })}
              disabled={!copOn || copTemp.isPending}
              className={[
                'py-2 rounded-lg border text-[11px]',
                copLevel === opt.level && copOn
                  ? 'bg-[#f59e0b]/15 border-[#f59e0b]/40 text-[#f59e0b]'
                  : 'bg-[#1a1a1a] border-[#2a2a2a] text-[#9ca3af]',
                !copOn ? 'opacity-50' : '',
              ].join(' ')}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    </ControlCard>
  );
}

function PowerIcon({ off }: { off?: boolean } = {}) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" opacity={off ? 0.6 : 1}>
      <path d="M12 2v10" />
      <path d="M5.6 6.6a8 8 0 1 0 12.8 0" />
    </svg>
  );
}

function FlameIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2c1 4-3 6-3 10a3 3 0 1 0 6 0c0-2-1-3-1-5 2 2 4 4 4 7a6 6 0 1 1-12 0c0-5 6-7 6-12z" />
    </svg>
  );
}

function WheelIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="3" />
      <path d="M12 9V3M9.5 14L4 18M14.5 14l5.5 4" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z" />
    </svg>
  );
}
