import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  useControlAvailability,
  useVehicleState,
  useRefreshVehicleState,
  useWakeVehicle,
} from '../hooks/useVehicleControl';
import { useVehicleStatus } from '../hooks/useVehicle';
import ClimateCard from '../components/control/ClimateCard';
import ChargeCard from '../components/control/ChargeCard';
import AccessCard from '../components/control/AccessCard';
import OpeningsCard from '../components/control/OpeningsCard';
import MediaCard from '../components/control/MediaCard';
import SoftwareCard from '../components/control/SoftwareCard';
import RefreshIndicator from '../components/RefreshIndicator';

interface Props {
  carId: number | undefined;
}

/**
 * Full Control page. Long-scroll layout (mobile-first), one card per
 * functional area. Per Tesla's vampire-drain guidance we DO NOT poll
 * vehicle_data — the snapshot loads once on mount, lives 30s in cache,
 * and the user can hit "Refresh" or any command to force-refresh.
 *
 * Visible only if Fleet API is connected and the current car has the
 * virtual key paired. Unpaired cars get a banner pointing to Settings.
 */
export default function Control({ carId }: Props) {
  const { t } = useTranslation();
  const { data: availability, isLoading: availLoading } = useControlAvailability();
  const { data: vehicleStatus } = useVehicleStatus(carId);

  // Map TeslaMate carId → TeslaHub TeslaVehicle.Id by VIN. We need the
  // Fleet-side id (paired key + Fleet vehicle_id), not the TeslaMate one.
  //
  // Multi-account aware: the same VIN can legitimately appear TWICE
  // in the Fleet list when a car is both owned by one account (paired)
  // and shared as Driver with another account (not paired — see the
  // Tesla docs limitation on third-party virtual keys). Prefer the
  // paired row so every command is routed through the actual owner's
  // OAuth token.
  //
  // Multi-car safety: if the selected TeslaMate car's VIN does NOT match
  // any Fleet vehicle, return undefined and surface a setup banner —
  // never silently fall back to vehicles[0], which would route commands
  // to the wrong car.
  const teslaVehicle = useMemo(() => {
    if (!availability?.vehicles?.length) return undefined;
    const vin = vehicleStatus?.vin;
    if (!vin) return undefined;
    const matches = availability.vehicles.filter((v) => v.vin === vin);
    if (matches.length === 0) return undefined;
    return matches.find((v) => v.keyPaired) ?? matches[0];
  }, [availability, vehicleStatus?.vin]);

  const vinMismatch = !!availability?.vehicles?.length
    && !!vehicleStatus?.vin
    && !teslaVehicle;

  const vehicleId = teslaVehicle?.id;
  const { data: snapshot, isLoading: stateLoading, isFetching } = useVehicleState(vehicleId);
  const refresh = useRefreshVehicleState();
  const wake = useWakeVehicle(vehicleId);

  if (availLoading) {
    return <div className="p-4 text-sm text-[#9ca3af]">{t('control.loading')}</div>;
  }

  if (!availability?.configured) {
    return <SetupBanner intent="configure" />;
  }
  if (!availability.connected) {
    return <SetupBanner intent="connect" />;
  }
  if (vinMismatch) {
    return <SetupBanner intent="vinMismatch" displayName={vehicleStatus?.name ?? vehicleStatus?.vin ?? ''} />;
  }
  if (!teslaVehicle) {
    return <SetupBanner intent="syncVehicles" />;
  }
  if (!teslaVehicle.keyPaired) {
    return <SetupBanner intent="pairKey" displayName={teslaVehicle.displayName ?? teslaVehicle.vin} />;
  }

  const state = snapshot?.state ?? null;
  const online = state?.toLowerCase() === 'online';
  const asleep = state?.toLowerCase() === 'asleep';
  const offline = state?.toLowerCase() === 'offline';

  const stateLabel = online
    ? t('control.state.online')
    : asleep
      ? t('control.state.asleep')
      : offline
        ? t('control.state.offline')
        : t('control.state.unknown');

  const stateColor = online
    ? 'text-[#22c55e] border-[#22c55e]/40 bg-[#22c55e]/10'
    : offline
      ? 'text-[#e31937] border-[#e31937]/40 bg-[#e31937]/10'
      : 'text-[#9ca3af] border-[#2a2a2a]';

  return (
    <div className="px-3 sm:px-4 pt-3 max-w-2xl mx-auto">
      {/* Sticky header */}
      <header className="sticky top-0 z-10 -mx-3 sm:-mx-4 px-3 sm:px-4 py-3 bg-[#0a0a0a]/95 backdrop-blur border-b border-[#2a2a2a] mb-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-base font-semibold text-[#e0e0e0] truncate">
              {snapshot?.displayName ?? teslaVehicle.displayName ?? teslaVehicle.vin}
            </h1>
            <div className="flex items-center gap-2 mt-0.5">
              <span className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full border ${stateColor}`}>
                {stateLabel}
              </span>
              {vehicleStatus?.batteryLevel != null && (
                <span className="text-xs text-[#9ca3af]">
                  {vehicleStatus.batteryLevel}%
                  {vehicleStatus.ratedBatteryRangeKm != null && (
                    <span className="text-[#6b7280] ml-1">
                      · {Math.round(vehicleStatus.ratedBatteryRangeKm)} km
                    </span>
                  )}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1">
            {!online && (
              <button
                type="button"
                onClick={() => wake.mutate(undefined as never)}
                disabled={wake.isPending}
                className="px-3 py-1.5 text-xs rounded-lg border border-[#3b82f6]/40 text-[#3b82f6] bg-[#3b82f6]/10 disabled:opacity-50"
              >
                {wake.isPending
                  ? (wake.wakingHint ? t('control.feedback.waking') : t('control.feedback.sending'))
                  : t('control.wake')}
              </button>
            )}
            <button
              type="button"
              onClick={() => vehicleId && refresh.mutate(vehicleId)}
              disabled={refresh.isPending || isFetching}
              className="p-2 rounded-lg border border-[#2a2a2a] text-[#9ca3af]"
              title={t('control.refresh')}
              aria-label={t('control.refresh')}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={refresh.isPending || isFetching ? 'animate-spin' : ''}>
                <path d="M21 12a9 9 0 0 1-15.9 5.9L3 16M3 12a9 9 0 0 1 15.9-5.9L21 8M3 8V3M3 8h5M21 16v5M21 16h-5" />
              </svg>
            </button>
          </div>
        </div>

        {asleep && (
          <p className="text-[11px] text-[#6b7280] mt-2">
            {t('control.asleepHint')}
          </p>
        )}
      </header>

      {stateLoading && !snapshot && (
        <p className="text-sm text-[#9ca3af] mb-3">{t('control.loading')}</p>
      )}

      {/* Post-command countdown — sits between header and cards so it's
          the very first thing the user sees after a tap. */}
      <RefreshIndicator vehicleId={vehicleId} className="mb-3" />

      {/* Stale-state banner: when the car is asleep/offline we deliberately
          skip vehicle_data (anti vampire-drain). The cards then hydrate
          from TeslaMate MQTT for whatever it has (climate on/off, temps,
          locks, sentry, charge state, …). The handful of fields that
          MQTT does NOT publish — cabin overheat protection, COP temp,
          seat heaters, bioweapon, valet, software_update — display their
          UI defaults. This banner makes that explicit. */}
      {!online && (
        <div className="bg-[#f59e0b]/10 border border-[#f59e0b]/30 rounded-xl p-3 mb-3 text-[12px] text-[#f59e0b]">
          {t('control.staleHint')}
        </div>
      )}

      <div className="space-y-3 pb-4">
        <ClimateCard vehicleId={vehicleId!} snapshot={snapshot} vehicleStatus={vehicleStatus} capabilities={teslaVehicle.capabilities} online={online} />
        <ChargeCard vehicleId={vehicleId!} snapshot={snapshot} vehicleStatus={vehicleStatus} capabilities={teslaVehicle.capabilities} online={online} />
        <AccessCard vehicleId={vehicleId!} snapshot={snapshot} vehicleStatus={vehicleStatus} online={online} />
        <OpeningsCard vehicleId={vehicleId!} snapshot={snapshot} vehicleStatus={vehicleStatus} capabilities={teslaVehicle.capabilities} online={online} />
        <MediaCard vehicleId={vehicleId!} online={online} />
        <SoftwareCard vehicleId={vehicleId!} snapshot={snapshot} online={online} />

        {/* Navigation lives on the Map page (richer search + reverse geocode). */}
        <Link
          to="/map"
          className="flex items-center justify-between bg-[#141414] border border-[#2a2a2a] rounded-xl p-4 text-sm text-[#9ca3af] active:bg-[#1a1a1a]"
        >
          <span className="flex items-center gap-2">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="10" r="3" />
              <path d="M12 2a8 8 0 0 0-8 8c0 5 8 12 8 12s8-7 8-12a8 8 0 0 0-8-8z" />
            </svg>
            {t('control.navigation.openMap')}
          </span>
          <span>→</span>
        </Link>
      </div>
    </div>
  );
}

function SetupBanner({ intent, displayName }: { intent: 'configure' | 'connect' | 'pairKey' | 'syncVehicles' | 'vinMismatch'; displayName?: string }) {
  const { t } = useTranslation();
  return (
    <div className="p-4 max-w-md mx-auto">
      <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl p-5">
        <h2 className="text-base font-semibold text-[#e0e0e0] mb-2">
          {t(`control.setup.${intent}.title`)}
        </h2>
        <p className="text-sm text-[#9ca3af] mb-4">
          {t(`control.setup.${intent}.body`, { name: displayName ?? '' })}
        </p>
        <Link
          to="/settings"
          className="inline-block px-4 py-2 rounded-lg bg-[#e31937] text-white text-sm"
        >
          {t('control.setup.goToSettings')}
        </Link>
      </div>
    </div>
  );
}
