import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import ControlCard from './ControlCard';
import ControlButton from './ControlButton';
import PinPad from './PinPad';
import { useControlMutation, type VehicleStateSnapshot } from '../../hooks/useVehicleControl';
import { readVehicle } from './stateParsers';

interface Props {
  vehicleId: number;
  snapshot: VehicleStateSnapshot | undefined;
  online: boolean;
}

const ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
);

/**
 * Access controls: locks, sentry, lights, horn, valet (PIN), speed limit (PIN).
 * Only the two PIN-protected actions open a modal — everything else
 * is one-tap with optimistic colouring.
 */
export default function AccessCard({ vehicleId, snapshot, online }: Props) {
  const { t } = useTranslation();
  const v = readVehicle(snapshot);

  const lock = useControlMutation(vehicleId, 'access/lock');
  const unlock = useControlMutation(vehicleId, 'access/unlock');
  const flash = useControlMutation(vehicleId, 'access/flash-lights');
  const honk = useControlMutation(vehicleId, 'access/honk-horn');
  const sentry = useControlMutation<{ on: boolean }>(vehicleId, 'access/sentry');
  const valet = useControlMutation<{ on: boolean; pin?: string }>(vehicleId, 'access/valet');
  const speedSet = useControlMutation<{ pin: string }>(vehicleId, 'access/speed-limit/activate');
  const speedDeact = useControlMutation<{ pin: string }>(vehicleId, 'access/speed-limit/deactivate');

  const [valetPinOpen, setValetPinOpen] = useState(false);
  const [speedPinOpen, setSpeedPinOpen] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);

  const isLocked = v.locked ?? true;
  const sentryOn = v.sentry_mode ?? false;
  const valetOn = v.valet_mode ?? false;
  const speedActive = v.speed_limit_mode?.active ?? false;

  const handleValetPin = (pin: string) => {
    setPinError(null);
    valet.mutate(
      { on: !valetOn, pin },
      {
        onSuccess: () => setValetPinOpen(false),
        onError: (e) => setPinError(e.message),
      },
    );
  };

  const handleSpeedPin = (pin: string) => {
    setPinError(null);
    const fn = speedActive ? speedDeact : speedSet;
    fn.mutate(
      { pin },
      {
        onSuccess: () => setSpeedPinOpen(false),
        onError: (e) => setPinError(e.message),
      },
    );
  };

  return (
    <>
      <ControlCard title={t('control.access.title')} icon={ICON}>
        <div className="grid grid-cols-2 gap-2">
          <ControlButton
            label={t('control.access.lock')}
            onClick={() => lock.mutate(undefined as never)}
            state={isLocked ? 'on' : 'neutral'}
            loading={lock.isPending}
            wakingHint={lock.wakingHint}
            disabled={!online}
            icon={<LockIcon />}
          />
          <ControlButton
            label={t('control.access.unlock')}
            onClick={() => unlock.mutate(undefined as never)}
            state={!isLocked ? 'danger' : 'neutral'}
            loading={unlock.isPending}
            wakingHint={unlock.wakingHint}
            disabled={!online}
            icon={<UnlockIcon />}
          />
          <ControlButton
            label={t('control.access.sentry')}
            onClick={() => sentry.mutate({ on: !sentryOn })}
            state={sentryOn ? 'info' : 'neutral'}
            loading={sentry.isPending}
            wakingHint={sentry.wakingHint}
            disabled={!online}
            icon={<EyeIcon />}
          />
          <ControlButton
            label={t('control.access.flash')}
            onClick={() => flash.mutate(undefined as never)}
            loading={flash.isPending}
            wakingHint={flash.wakingHint}
            disabled={!online}
            icon={<HeadlightIcon />}
          />
          <ControlButton
            label={t('control.access.honk')}
            onClick={() => honk.mutate(undefined as never)}
            loading={honk.isPending}
            wakingHint={honk.wakingHint}
            disabled={!online}
            icon={<HornIcon />}
          />
          <ControlButton
            label={t('control.access.valet')}
            onClick={() => { setPinError(null); setValetPinOpen(true); }}
            state={valetOn ? 'warning' : 'neutral'}
            disabled={!online}
            icon={<ValetIcon />}
          />
        </div>

        <div className="mt-3 pt-3 border-t border-[#2a2a2a]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-[#9ca3af]">
              {t('control.access.speedLimit')}
              {v.speed_limit_mode?.current_limit_mph != null && (
                <span className="text-[#6b7280] ml-2">
                  {v.speed_limit_mode.current_limit_mph} mph
                </span>
              )}
            </span>
            <ControlButton
              label={speedActive ? t('control.access.speedLimit.deactivate') : t('control.access.speedLimit.activate')}
              onClick={() => { setPinError(null); setSpeedPinOpen(true); }}
              state={speedActive ? 'warning' : 'neutral'}
              disabled={!online}
              size="sm"
            />
          </div>
        </div>
      </ControlCard>

      <PinPad
        open={valetPinOpen}
        title={valetOn ? t('control.access.valet.disable') : t('control.access.valet.enable')}
        subtitle={t('control.access.valet.pinHint')}
        loading={valet.isPending}
        error={pinError}
        onSubmit={handleValetPin}
        onClose={() => setValetPinOpen(false)}
      />
      <PinPad
        open={speedPinOpen}
        title={speedActive ? t('control.access.speedLimit.deactivate') : t('control.access.speedLimit.activate')}
        subtitle={t('control.access.speedLimit.pinHint')}
        loading={speedSet.isPending || speedDeact.isPending}
        error={pinError}
        onSubmit={handleSpeedPin}
        onClose={() => setSpeedPinOpen(false)}
      />
    </>
  );
}

function LockIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}
function UnlockIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 7-1" />
    </svg>
  );
}
function EyeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
function HeadlightIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 6v2M12 16v2M5 12H3M21 12h-2M7 7l-1.5-1.5M18.5 18.5L17 17M17 7l1.5-1.5M5.5 18.5L7 17" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
function HornIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 10v4l5 1v-6L3 10zM8 9l8-4v14l-8-4V9z" />
    </svg>
  );
}
function ValetIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="3" />
      <path d="M5 21c0-4 3-7 7-7s7 3 7 7" />
    </svg>
  );
}
