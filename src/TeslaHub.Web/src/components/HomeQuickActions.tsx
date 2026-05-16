import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import ControlButton, { type ControlButtonState } from './control/ControlButton';
import { capabilitiesLoaded, presumeSupported, useControlAvailability, useControlMutation } from '../hooks/useVehicleControl';
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

  // Derived state — computed BEFORE the mutation hooks so the path
  // suffix passed to `useControlMutation` reflects the current toggle.
  // Same pattern as ChargeCard / ClimateCard.
  const isClimateOn = vehicle?.isClimateOn ?? false;
  // chargingState comes from TeslaMate's MQTT cache. "Charging" /
  // "Starting" / "NoPower" / "Stopped" / "Complete" / "Disconnected".
  // Only treat an actively-charging session as "stop" target.
  const isCharging = vehicle?.chargingState === 'Charging' || vehicle?.chargingState === 'Starting';

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
  // New: charge + climate + defrost. defrost = Tesla "set_preconditioning_max"
  // (= "Dégivrage du véhicule" in the mobile app). Same endpoint Control
  // page's "Précondition" button uses; we keep the wording explicit on
  // Home because most users tap it when they actually want to defrost.
  const climateToggle = useControlMutation(vehicleId, isClimateOn ? 'climate/stop' : 'climate/start');
  const defrost = useControlMutation<{ on: boolean }>(vehicleId, 'climate/precondition');
  const chargePort = useControlMutation<{ on: boolean }>(vehicleId, 'charge/port-door');
  const chargeToggle = useControlMutation(vehicleId, isCharging ? 'charge/stop' : 'charge/start');

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
  const portOpen = vehicle.chargePortDoorOpen ?? false;
  const pluggedIn = vehicle.pluggedIn ?? false;
  // MQTT doesn't expose defrost_mode (Tesla telemetry channel) so we
  // approximate the "Dégivrage actif" state with the windshield-side
  // defrosters. Front defroster ON means max-defrost was requested in
  // virtually every real-world scenario; the Control page still shows
  // the authoritative defrost_mode from vehicle_data.
  const defrostActive = (vehicle.isFrontDefrosterOn ?? false) || (vehicle.isRearDefrosterOn ?? false);
  const caps = teslaVehicle.capabilities;
  // Show frunk/trunk chips by default (every modern Tesla actuates
  // both lids). Only hide when vehicle_config explicitly says false.
  const showTrunks = !capabilitiesLoaded(caps) || caps.canActuateTrunks;
  // Same logic for the charge-port-door actuator: most Teslas have it,
  // and the read-only "Tesla Roadster / Model S 2012 manual port" is
  // the only modern exception. presumeSupported keeps the chip when
  // capabilities haven't been fetched yet (sleeping car never woken).
  const showChargePort = presumeSupported(caps, caps.motorizedChargePort);

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
        {/* Climate toggle — same Tesla command pair as ClimateCard. */}
        <ControlButton
          label={t('home.quickActions.climate')}
          state={isClimateOn ? 'on' : 'neutral'}
          onClick={() => climateToggle.mutate(undefined as never)}
          loading={climateToggle.isPending}
          wakingHint={climateToggle.wakingHint}
          icon={<ClimateGlyph />}
        />
        {/* Max defrost. We toggle by sending the OPPOSITE of the current
            visible defrost state, mirroring how the Tesla app behaves. */}
        <ControlButton
          label={t('home.quickActions.defrost')}
          state={defrostActive ? 'warning' : 'neutral'}
          onClick={() => defrost.mutate({ on: !defrostActive })}
          loading={defrost.isPending}
          wakingHint={defrost.wakingHint}
          icon={<DefrostGlyph />}
        />
        {showChargePort && (
          <ControlButton
            label={t('home.quickActions.chargePort')}
            state={portOpen ? 'warning' : 'neutral'}
            onClick={() => chargePort.mutate({ on: !portOpen })}
            loading={chargePort.isPending}
            wakingHint={chargePort.wakingHint}
            icon={<ChargePortGlyph />}
          />
        )}
        {/* Start/stop charge. Disabled (visually muted) when the car
            is not plugged in — sending "charge_start" without a cable
            attached just returns an error from the Fleet API. */}
        <ControlButton
          label={isCharging ? t('home.quickActions.chargeStop') : t('home.quickActions.charge')}
          state={isCharging ? 'on' : 'neutral'}
          onClick={() => chargeToggle.mutate(undefined as never)}
          loading={chargeToggle.isPending}
          wakingHint={chargeToggle.wakingHint}
          disabled={!pluggedIn}
          icon={<ChargeBoltGlyph />}
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
function ClimateGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v18M5 7l14 10M5 17 19 7" />
      <path d="M12 3l-2 2M12 3l2 2M12 21l-2-2M12 21l2-2" />
    </svg>
  );
}
function DefrostGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 18c2-2 2-4 4-4M8 18c2-2 2-4 4-4M12 18c2-2 2-4 4-4M16 18c2-2 2-4 4-4" />
      <path d="M3 9h18" />
    </svg>
  );
}
function ChargePortGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="6" width="16" height="12" rx="3" />
      <circle cx="9" cy="12" r="1.4" />
      <circle cx="15" cy="12" r="1.4" />
      <path d="M12 9v6" />
    </svg>
  );
}
function ChargeBoltGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" />
    </svg>
  );
}
