import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import ControlButton, { type ControlButtonState } from './control/ControlButton';
import { capabilitiesLoaded, useControlAvailability, useControlMutation } from '../hooks/useVehicleControl';
import RefreshIndicator from './RefreshIndicator';
import type { VehicleStatus } from '../api/queries';

interface Props {
  vehicle: VehicleStatus | undefined;
}

/**
 * Compact one-row strip of remote actions on the Home page. Visible only
 * when ALL of these are true (per user requirements):
 *   - MQTT live data is available (otherwise we can't reflect state),
 *   - Fleet API is configured AND connected,
 *   - the current car has the virtual key paired.
 *
 * Renders silently nothing if any condition is missing — the Home page
 * stays informational for users without Fleet API set up.
 */
export default function HomeQuickActions({ vehicle }: Props) {
  const { t } = useTranslation();
  const { data: availability } = useControlAvailability();

  // Multi-account: prefer the paired entry if the same VIN appears
  // under two Tesla accounts (owner + driver-shared). Only the owner
  // entry can accept signed commands.
  const teslaVehicle = useMemo(() => {
    if (!availability?.vehicles?.length) return undefined;
    if (!vehicle?.vin) return undefined;
    const matches = availability.vehicles.filter((v) => v.vin === vehicle.vin);
    if (matches.length === 0) return undefined;
    return matches.find((v) => v.keyPaired) ?? matches[0];
  }, [availability, vehicle?.vin]);

  // All hooks MUST run before any early return: React's rules of hooks.
  // We pass vehicleId=0 fallbacks; the buttons themselves are disabled
  // when there is no vehicleId so no command will fire.
  const vehicleId = teslaVehicle?.id;
  const lock = useControlMutation(vehicleId, 'access/lock');
  const unlock = useControlMutation(vehicleId, 'access/unlock');
  const sentry = useControlMutation<{ on: boolean }>(vehicleId, 'access/sentry');
  const trunk = useControlMutation<{ which: string }>(vehicleId, 'access/trunk');
  const window = useControlMutation<{ command: string }>(vehicleId, 'access/window');
  const flash = useControlMutation(vehicleId, 'access/flash-lights');
  const honk = useControlMutation(vehicleId, 'access/honk-horn');

  const mqttAvailable = !!vehicle?.mqttConnected;
  const fleetReady = !!availability?.configured && !!availability?.connected;
  const paired = !!teslaVehicle?.keyPaired;

  if (!vehicle || !mqttAvailable || !fleetReady || !paired || !vehicleId) {
    return null;
  }

  const isLocked = vehicle.isLocked ?? true;
  const sentryOn = vehicle.sentryMode ?? false;
  const frunkOpen = vehicle.frunkOpen ?? false;
  const trunkOpen = vehicle.trunkOpen ?? false;
  const windowsOpen = vehicle.windowsOpen ?? false;
  const caps = teslaVehicle.capabilities;
  // Show frunk/trunk chips by default (every modern Tesla actuates
  // both lids). Only hide when vehicle_config explicitly says false.
  const showTrunks = !capabilitiesLoaded(caps) || caps.canActuateTrunks;

  return (
    <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl p-3 mt-3">
      {/* Post-command countdown / refreshing indicator. Invisible when
          no command is pending. Lets the user know fresh state is
          inbound rather than thinking the page is frozen. */}
      <RefreshIndicator vehicleId={vehicleId} compact className="mb-2" />
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] uppercase tracking-wide text-[#6b7280]">
          {t('home.quickActions.title')}
        </span>
        <Link to="/control" className="text-[11px] text-[#9ca3af] active:text-[#e0e0e0]">
          {t('home.quickActions.more')} →
        </Link>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {/* Lock toggles dynamically: green when secure, red when open. */}
        <ControlButton
          label={isLocked ? t('home.quickActions.locked') : t('home.quickActions.unlocked')}
          state={(isLocked ? 'on' : 'danger') as ControlButtonState}
          onClick={() => (isLocked ? unlock : lock).mutate(undefined as never)}
          loading={lock.isPending || unlock.isPending}
          wakingHint={lock.wakingHint || unlock.wakingHint}
          icon={<LockGlyph open={!isLocked} />}
        />
        <ControlButton
          label={t('home.quickActions.sentry')}
          state={sentryOn ? 'info' : 'neutral'}
          onClick={() => sentry.mutate({ on: !sentryOn })}
          loading={sentry.isPending}
          wakingHint={sentry.wakingHint}
          icon={<EyeGlyph />}
        />
        {showTrunks && (
          <ControlButton
            label={t('home.quickActions.frunk')}
            state={frunkOpen ? 'warning' : 'neutral'}
            onClick={() => trunk.mutate({ which: 'front' })}
            loading={trunk.isPending && (trunk.variables as { which?: string } | undefined)?.which === 'front'}
            wakingHint={trunk.wakingHint}
            icon={<TrunkGlyph front />}
          />
        )}
        {showTrunks && (
          <ControlButton
            label={t('home.quickActions.trunk')}
            state={trunkOpen ? 'warning' : 'neutral'}
            onClick={() => trunk.mutate({ which: 'rear' })}
            loading={trunk.isPending && (trunk.variables as { which?: string } | undefined)?.which === 'rear'}
            wakingHint={trunk.wakingHint}
            icon={<TrunkGlyph />}
          />
        )}
        <ControlButton
          label={t('home.quickActions.vent')}
          state={windowsOpen ? 'warning' : 'neutral'}
          onClick={() => window.mutate({ command: 'vent' })}
          loading={window.isPending && (window.variables as { command?: string } | undefined)?.command === 'vent'}
          wakingHint={window.wakingHint}
          icon={<WindowGlyph />}
        />
        <ControlButton
          label={t('home.quickActions.closeWindows')}
          onClick={() => window.mutate({ command: 'close' })}
          loading={window.isPending && (window.variables as { command?: string } | undefined)?.command === 'close'}
          wakingHint={window.wakingHint}
          icon={<WindowGlyph closed />}
        />
        <ControlButton
          label={t('home.quickActions.flash')}
          onClick={() => flash.mutate(undefined as never)}
          loading={flash.isPending}
          wakingHint={flash.wakingHint}
          icon={<HeadlightGlyph />}
        />
        <ControlButton
          label={t('home.quickActions.honk')}
          onClick={() => honk.mutate(undefined as never)}
          loading={honk.isPending}
          wakingHint={honk.wakingHint}
          icon={<HornGlyph />}
        />
      </div>
    </div>
  );
}

// Inline icons kept tiny and dependency-free (matches the existing
// VehicleTopView style — no icon library bloat).
function LockGlyph({ open }: { open?: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      {open ? <path d="M8 11V7a4 4 0 0 1 7-1" /> : <path d="M8 11V7a4 4 0 0 1 8 0v4" />}
    </svg>
  );
}
function EyeGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
function TrunkGlyph({ front }: { front?: boolean } = {}) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 13l2-6h14l2 6" />
      <rect x="2" y="13" width="20" height="6" rx="2" />
      {front ? <path d="M9 7l-1-2" /> : <path d="M15 7l1-2" />}
    </svg>
  );
}
function WindowGlyph({ closed }: { closed?: boolean } = {}) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="4" width="16" height="16" rx="2" />
      {!closed && <path d="M4 12h16" />}
    </svg>
  );
}
function HeadlightGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 6v2M12 16v2M5 12H3M21 12h-2M7 7l-1.5-1.5M18.5 18.5L17 17M17 7l1.5-1.5M5.5 18.5L7 17" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
function HornGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 10v4l5 1v-6L3 10zM8 9l8-4v14l-8-4V9z" />
    </svg>
  );
}
