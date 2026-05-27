import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useUnits } from '../hooks/useUnits';
import type { VehicleStatus } from '../api/queries';

interface CostStack {
  totalCostAvailable: number;
  totalCostConsumed: number;
  costPerKm: number | null;
  isSubscription: boolean;
}

interface DriveStatsMin {
  maxSpeedKmh: number | null;
}

interface Props {
  vehicle: VehicleStatus;
  driveStats: DriveStatsMin | null | undefined;
  kmSinceCharge: number;
  costStack: CostStack | null | undefined;
  lastCompletedChargeId?: number;
  onShowCostInfo?: () => void;
}

/**
 * Compact "meta" strip that aggregates the secondary bits the legacy
 * hero overlaid (vehicle name + VIN, max-speed, last-charge cost).
 * In the 3D-hero layout they no longer fit cleanly on top of the car,
 * so we surface them just below as a horizontal strip of mini-stats.
 *
 * Mobile lays them out as `name+VIN | max speed | last charge`. Desktop
 * fits the same 3 cells without scrollbars; each cell is a clickable
 * shortcut where it makes sense (last charge → /charging).
 */
export default function HomeMetaStrip({
  vehicle,
  driveStats,
  kmSinceCharge,
  costStack,
  onShowCostInfo,
}: Props) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const u = useUnits();
  // VIN copy-to-clipboard feedback. Resets after 1.6s so the button
  // doesn't permanently say "Copied".
  const [vinCopied, setVinCopied] = useState(false);

  const copyVin = async () => {
    if (!vehicle.vin) return;
    try {
      // navigator.clipboard requires HTTPS + permission grant. Fall
      // back to the legacy textarea-select trick on environments
      // where it's not available (some in-car browsers).
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(vehicle.vin);
      } else {
        const ta = document.createElement('textarea');
        ta.value = vehicle.vin;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setVinCopied(true);
      setTimeout(() => setVinCopied(false), 1600);
    } catch {
      // Silent — user can long-press the VIN to system-copy as a
      // last resort. select-all + cursor-text on the text element
      // makes that possible.
    }
  };

  const maxSpeedKmh = driveStats?.maxSpeedKmh;
  const speedUserUnit =
    maxSpeedKmh != null ? Math.round(u.convertDistance(maxSpeedKmh)!) : null;
  const speedUnitLabel = u.distanceUnit === 'mi' ? 'mph' : 'km/h';

  const isSubscription = costStack?.isSubscription ?? false;
  const lastChargeCost = costStack ? costStack.totalCostAvailable : null;
  const consumed = costStack && costStack.totalCostConsumed > 0
    ? costStack.totalCostConsumed
    : null;
  const costPerKm = costStack?.costPerKm ?? null;

  return (
    <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl px-3 py-2 grid grid-cols-3 gap-2 items-center">
      <div className="min-w-0">
        <div className="text-sm font-bold truncate">
          {vehicle.marketingName || vehicle.model || vehicle.name}
        </div>
        {/* Exterior colour + VIN. VIN is rendered on its own line so it
            doesn't get truncated on narrow phones, with cursor-text +
            select-all so the user can long-press to copy on touch
            devices that block our clipboard API. The little button
            on the right offers the explicit copy path with feedback. */}
        <div className="text-[10px] text-[#9ca3af] truncate">
          {vehicle.exteriorColor || ''}
        </div>
        {vehicle.vin && (
          <button
            type="button"
            onClick={copyVin}
            title={vinCopied ? t('home.vinCopied', 'VIN copié') : t('home.vinCopy', 'Copier le VIN')}
            className="mt-0.5 inline-flex items-center gap-1 max-w-full text-[10px] text-[#9ca3af] hover:text-white active:text-[#22c55e] transition-colors group"
          >
            <span className="font-mono tabular-nums tracking-tight select-all break-all text-left">
              {vehicle.vin}
            </span>
            {vinCopied ? (
              <svg
                className="shrink-0 text-[#22c55e]"
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg
                className="shrink-0 opacity-60 group-hover:opacity-100"
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="9" y="9" width="11" height="11" rx="2" />
                <path d="M5 15V5a2 2 0 0 1 2-2h10" />
              </svg>
            )}
          </button>
        )}
      </div>

      <div className="text-center border-x border-[#2a2a2a]">
        <div className="text-[10px] text-[#9ca3af] uppercase tracking-wider">
          {t('home.maxSpeed')}
        </div>
        <div className="text-base font-bold tabular-nums text-[#e31937]">
          {speedUserUnit ?? '—'}
          <span className="text-[10px] font-normal text-[#9ca3af] ml-1">
            {speedUnitLabel}
          </span>
        </div>
      </div>

      {isSubscription ? (
        <div
          className="text-right cursor-pointer active:opacity-70"
          onClick={() => navigate('/charging')}
        >
          <div className="text-[10px] text-[#9ca3af] uppercase tracking-wider">
            {t('home.lastCharge')}
          </div>
          <div className="text-base font-bold tabular-nums text-[#3b82f6]">
            {t('home.subscription')}
          </div>
          {kmSinceCharge >= 1 && (
            <div className="text-[10px] text-[#9ca3af] tabular-nums">
              {Math.round(u.convertDistance(kmSinceCharge)!)} {u.distanceUnit}{' '}
              {t('home.sinceCharge')}
            </div>
          )}
        </div>
      ) : lastChargeCost != null && lastChargeCost > 0 ? (
        <div className="text-right">
          <div className="text-[10px] text-[#9ca3af] uppercase tracking-wider flex items-center justify-end gap-1">
            <span
              className="cursor-pointer active:opacity-70"
              onClick={() => navigate('/charging')}
            >
              {t('home.lastCharge')}
            </span>
            {onShowCostInfo && (
              <button
                type="button"
                onClick={onShowCostInfo}
                className="w-3.5 h-3.5 rounded-full border border-[#9ca3af]/50 text-[8px] text-[#9ca3af] flex items-center justify-center"
              >
                i
              </button>
            )}
          </div>
          <div
            className="text-base font-bold tabular-nums text-[#e31937] cursor-pointer active:opacity-70"
            onClick={() => navigate('/charging')}
          >
            {consumed != null ? `${consumed.toFixed(2)} / ` : ''}
            {lastChargeCost.toFixed(2)} {u.currencySymbol}
          </div>
          {kmSinceCharge >= 1 && (
            <div className="text-[10px] text-[#9ca3af] tabular-nums">
              {Math.round(u.convertDistance(kmSinceCharge)!)} {u.distanceUnit}
              {costPerKm != null && costPerKm > 0 && (
                <> · {costPerKm.toFixed(2)} {u.currencySymbol}/{u.distanceUnit}</>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="text-right text-[#6b7280] text-xs">—</div>
      )}
    </div>
  );
}
