import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { VehicleStatus } from '../../api/queries';
import type { VehicleStateSnapshot } from '../../hooks/useVehicleControl';
import { useUnits } from '../../hooks/useUnits';
import { readCharge, readClimate, readVehicle } from './stateParsers';

interface Props {
  snapshot: VehicleStateSnapshot | undefined;
  vehicleStatus?: VehicleStatus;
}

/**
 * Compact strip rendered at the top of the Control page.
 *
 * Four square tiles surface the most-watched signals at a glance:
 *   - Climatisation: target temp + inside temp
 *   - Recharge:      battery %, plus charging delta when active
 *   - Verrouillage:  locked / unlocked
 *   - Ouvertures:    "all closed" / "N open"
 *
 * Each tile is a button — tapping it smooth-scrolls down to the
 * matching full card (`#control-climate`, `#control-charge`,
 * `#control-access`, `#control-openings`). There is intentionally no
 * "drawer" or "page open" behaviour — the user always lands on the
 * SAME long scroll, the strip is just a table of contents.
 *
 * Data sources are the exact same parsers (`readClimate`, `readCharge`,
 * `readVehicle`) used by the cards, so a tile never disagrees with
 * the card below.
 */
export default function ControlQuickSummary({ snapshot, vehicleStatus }: Props) {
  const { t } = useTranslation();
  const u = useUnits();

  const climate = readClimate(snapshot, vehicleStatus);
  const charge = readCharge(snapshot, vehicleStatus);
  const v = readVehicle(snapshot, vehicleStatus);

  // ─── Climatisation ────────────────────────────────────────────────
  // Target temperature (driver-side) — same field the dial pivots on.
  // Falls back to the inside reading if we don't know the target yet
  // (sleeping car, freshly synced fleet).
  const targetC = climate.driver_temp_setting ?? null;
  const targetText =
    targetC != null
      ? `${u.tempUnit === '°F' ? Math.round(u.convertTemp(targetC) ?? targetC) : (u.convertTemp(targetC) ?? targetC).toFixed(1)}${u.tempUnit}`
      : '—';
  const insideText =
    climate.inside_temp != null
      ? `${u.tempUnit === '°F' ? Math.round(u.convertTemp(climate.inside_temp) ?? climate.inside_temp) : (u.convertTemp(climate.inside_temp) ?? climate.inside_temp).toFixed(1)}${u.tempUnit}`
      : null;
  const isClimateOn = climate.is_climate_on ?? climate.is_auto_conditioning_on ?? false;

  // ─── Recharge ─────────────────────────────────────────────────────
  const battery = charge.battery_level;
  const isCharging = (charge.charging_state ?? '').toLowerCase() === 'charging';
  const power = charge.charger_power;
  const chargeMain = battery != null ? `${battery}%` : '—';
  const chargeSub = isCharging && power != null
    ? `+${power.toFixed(1)} kW`
    : charge.battery_range != null
      ? `${u.fmtDist(charge.battery_range, 0)} ${u.distanceUnit}`
      : null;

  // ─── Verrouillage ────────────────────────────────────────────────
  const isLocked = v.locked ?? true;
  const sentryOn = v.sentry_mode ?? false;

  // ─── Ouvertures ──────────────────────────────────────────────────
  const frunkOpen = (v.ft ?? 0) > 0;
  const trunkOpen = (v.rt ?? 0) > 0;
  const windowsOpen = [v.fd_window, v.fp_window, v.rd_window, v.rp_window].some((w) => (w ?? 0) > 0);
  const openCount = (frunkOpen ? 1 : 0) + (trunkOpen ? 1 : 0) + (windowsOpen ? 1 : 0);

  return (
    <div className="grid grid-cols-4 gap-2 mb-3">
      <SummaryTile
        anchor="control-climate"
        icon={<SnowIcon />}
        accentBg="rgba(6, 182, 212, 0.10)"
        accentFg="#22d3ee"
        label={t('control.climate.title')}
        primary={targetText}
        secondary={
          insideText
            ? `${t('control.climate.inside')} ${insideText}`
            : isClimateOn
              ? t('control.climate.on', 'On')
              : t('control.climate.off', 'Off')
        }
        active={isClimateOn}
      />
      <SummaryTile
        anchor="control-charge"
        icon={<BoltIcon />}
        accentBg="rgba(34, 197, 94, 0.10)"
        accentFg="#22c55e"
        label={t('control.charge.title')}
        primary={chargeMain}
        secondary={chargeSub}
        active={isCharging}
      />
      <SummaryTile
        anchor="control-access"
        icon={<LockIcon open={!isLocked} />}
        accentBg={isLocked ? 'rgba(34, 197, 94, 0.10)' : 'rgba(239, 68, 68, 0.10)'}
        accentFg={isLocked ? '#22c55e' : '#ef4444'}
        label={t('control.access.title')}
        primary={isLocked ? t('control.access.locked', 'Locked') : t('control.access.unlocked', 'Unlocked')}
        secondary={
          sentryOn
            ? `${t('control.access.sentry')} · ${t('control.summary.on', 'On')}`
            : null
        }
        active={isLocked}
      />
      <SummaryTile
        anchor="control-openings"
        icon={<DoorIcon />}
        accentBg={openCount === 0 ? 'rgba(34, 197, 94, 0.10)' : 'rgba(245, 158, 11, 0.10)'}
        accentFg={openCount === 0 ? '#22c55e' : '#f59e0b'}
        label={t('control.openings.title')}
        primary={
          openCount === 0
            ? t('control.openings.allClosed', 'All closed')
            : t('control.openings.someOpen', { count: openCount, defaultValue: '{{count}} open' })
        }
        secondary={null}
        active={openCount === 0}
      />
    </div>
  );
}

interface TileProps {
  anchor: string;
  icon: ReactNode;
  /** Background colour of the icon badge (RGBA so it tints subtly). */
  accentBg: string;
  /** Foreground / stroke colour of the icon. */
  accentFg: string;
  /** Section title (used as the accessible name). */
  label: string;
  /** Big value (e.g. "22.0°C", "55%", "Locked", "All closed"). */
  primary: ReactNode;
  /** Secondary line (e.g. inside temp, range, sentry status). */
  secondary?: ReactNode;
  /** Whether the section is in a "positive" / "active" state. Drives
   *  the dot indicator next to the label. */
  active: boolean;
}

/**
 * Single quick-summary tile. Renders as a button so the entire
 * surface is tappable on mobile; activates a smooth-scroll to the
 * matching `<section id="...">` further down the page.
 */
function SummaryTile({
  anchor,
  icon,
  accentBg,
  accentFg,
  label,
  primary,
  secondary,
  active,
}: TileProps) {
  const handleClick = () => {
    const el = document.getElementById(anchor);
    if (!el) return;
    // Smooth scroll lands the section a bit below the sticky header
    // (sections have scroll-mt-24). prefer-reduced-motion users get
    // an instant jump via the browser's native handling of "behavior".
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={label}
      className="flex flex-col items-start gap-1.5 bg-[#141414] border border-[#2a2a2a] rounded-xl p-2.5 text-left active:bg-[#1a1a1a] hover:border-[#3a3a3a] transition-colors min-w-0"
    >
      <div className="flex items-center justify-between w-full">
        <span
          aria-hidden="true"
          className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: accentBg, color: accentFg }}
        >
          {icon}
        </span>
        <span
          aria-hidden="true"
          className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
            active ? '' : 'opacity-30'
          }`}
          style={{ backgroundColor: accentFg }}
        />
      </div>
      <span className="text-[10px] uppercase tracking-wide text-[#6b7280] truncate w-full">
        {label}
      </span>
      <span className="text-sm font-semibold text-[#e0e0e0] truncate w-full tabular-nums">
        {primary}
      </span>
      {secondary && (
        <span className="text-[10px] text-[#9ca3af] truncate w-full">
          {secondary}
        </span>
      )}
    </button>
  );
}

// ─── Icons ────────────────────────────────────────────────────────────

function SnowIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 2v20M2 12h20M5 5l14 14M19 5L5 19" />
    </svg>
  );
}

function BoltIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" />
    </svg>
  );
}

function LockIcon({ open }: { open?: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      {open ? <path d="M8 11V7a4 4 0 0 1 7-1" /> : <path d="M8 11V7a4 4 0 0 1 8 0v4" />}
    </svg>
  );
}

function DoorIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 12h18M5 12V8a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v4M7 16v3M17 16v3" />
    </svg>
  );
}
