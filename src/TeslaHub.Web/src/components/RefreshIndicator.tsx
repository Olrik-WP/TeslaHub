import { useTranslation } from 'react-i18next';
import { useRefreshCountdown } from '../hooks/useVehicleControl';

interface Props {
  vehicleId: number | undefined;
  /** Compact: smaller height, no left icon — good for the Home page under the SVG. */
  compact?: boolean;
  className?: string;
}

/**
 * Small banner that appears whenever a force-refresh is scheduled or
 * in flight after a Tesla command. Two states:
 *
 *   1. Countdown   : "Updating in 4s…" (one tick per second)
 *   2. Refreshing  : "Refreshing…" (after the request fires) then a
 *                    brief "Up to date" pulse before disappearing.
 *
 * Shown nowhere else than after a real command — when the user does
 * nothing the indicator is invisible. The point is purely UX: avoid
 * the user thinking the page is stuck because Tesla takes a few
 * seconds to propagate the command's effect to its read API.
 */
export default function RefreshIndicator({ vehicleId, compact, className }: Props) {
  const { t } = useTranslation();
  const { secondsUntil, isRefreshing } = useRefreshCountdown(vehicleId);

  if (secondsUntil === null && !isRefreshing) return null;

  const text = isRefreshing
    ? t('control.refresh.inFlight')
    : t('control.refresh.in', { seconds: secondsUntil });

  return (
    <div
      className={[
        'flex items-center gap-2 rounded-xl border border-[#3b82f6]/30 bg-[#3b82f6]/10 text-[#93c5fd]',
        compact ? 'px-3 py-1.5 text-[11px]' : 'px-3 py-2 text-xs',
        className ?? '',
      ].join(' ')}
      role="status"
      aria-live="polite"
    >
      <Spinner spinning={isRefreshing} />
      <span>{text}</span>
    </div>
  );
}

function Spinner({ spinning }: { spinning: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={spinning ? 'animate-spin' : ''}
    >
      <path d="M21 12a9 9 0 0 1-15.9 5.9L3 16M3 12a9 9 0 0 1 15.9-5.9L21 8M3 8V3M3 8h5M21 16v5M21 16h-5" />
    </svg>
  );
}
