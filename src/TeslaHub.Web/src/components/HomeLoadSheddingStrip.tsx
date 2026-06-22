import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { utcDate } from '../utils/date';
import type { VehicleStatus } from '../api/queries';

interface Props {
  vehicle: VehicleStatus;
}

type LoadSheddingHouse = {
  currentVa?: number | null;
  lastSampleAt?: string | null;
  samplesInLast60s: number;
  unit: string;
};

type LoadSheddingStatusVehicle = {
  vehicleId: number;
  vin: string;
  runtime?: {
    teslaVa?: number | null;
  } | null;
};

type LoadSheddingStatus = {
  house: LoadSheddingHouse;
  vehicles: LoadSheddingStatusVehicle[];
  mqttConnected: boolean;
};

type LoadSheddingEvent = {
  id: number;
  at: string;
  kind: string;
  fromAmps?: number | null;
  toAmps?: number | null;
  houseVa?: number | null;
  detail?: string | null;
};

// Compact colour palette mirroring LoadSheddingPanel's StatePill so the
// Home strip reads the same as the Settings timeline. Kept inline (and
// smaller) here on purpose: the Home version is a glanceable summary, not
// the full audit list.
const PILL_PALETTE: Record<string, { bg: string; text: string }> = {
  Reduce: { bg: 'bg-[#3a2a1a]', text: 'text-[#f0a47e]' },
  Raise: { bg: 'bg-[#1a3d1a]', text: 'text-[#a7e9a7]' },
  DryRunReduce: { bg: 'bg-[#1a2a3a]', text: 'text-[#7eb8f0]' },
  DryRunRaise: { bg: 'bg-[#1a2a3a]', text: 'text-[#7eb8f0]' },
  Skip: { bg: 'bg-[#1a1a1a]', text: 'text-[#9ca3af]' },
  QuotaHit: { bg: 'bg-[#3d1a1a]', text: 'text-[#f0a7a7]' },
  ProxyError: { bg: 'bg-[#3d1a1a]', text: 'text-[#f0a7a7]' },
  NoData: { bg: 'bg-[#1a1a1a]', text: 'text-[#9ca3af]' },
};

/**
 * Thin "live house power + last decisions" strip rendered under the Home
 * battery bar. It reuses the load-shedding endpoints the Settings page
 * polls, mapping the Home car (TeslaMate carId) to the Fleet vehicleId by
 * VIN. Renders nothing when load shedding is not configured/reachable, so
 * the hero stays clean for users who never set it up.
 */
export default function HomeLoadSheddingStrip({ vehicle }: Props) {
  const { t } = useTranslation();

  const { data: status } = useQuery<LoadSheddingStatus>({
    queryKey: ['loadShedding', 'status'],
    queryFn: () => api<LoadSheddingStatus>('/load-shedding/status'),
    refetchInterval: 3000,
  });

  const vin = vehicle.vin?.trim().toUpperCase() ?? null;
  const matched = vin
    ? status?.vehicles.find((v) => v.vin?.trim().toUpperCase() === vin) ?? null
    : null;
  const vehicleId = matched?.vehicleId ?? null;

  const { data: events } = useQuery<LoadSheddingEvent[]>({
    queryKey: ['loadShedding', 'homeEvents', vehicleId],
    queryFn: () => api<LoadSheddingEvent[]>(`/load-shedding/events?vehicleId=${vehicleId}&take=2`),
    refetchInterval: 5000,
    enabled: vehicleId !== null,
  });

  const va = status?.house?.currentVa;
  const hasPower = va !== null && va !== undefined;
  const unit = status?.house?.unit || 'VA';

  // Tesla's own draw as seen by the shedding engine (same unit as the
  // house total), so the user can read "how much of the house is the
  // car". Only shown while it's actually pulling power (> 0) to avoid a
  // noisy "0" line when the car is idle.
  const teslaVa = matched?.runtime?.teslaVa;
  const hasTeslaPower = teslaVa !== null && teslaVa !== undefined && teslaVa > 0;

  // Nothing useful to show: no live power reading AND no decisions. Keep
  // the hero block tidy rather than rendering an empty divider.
  if (!hasPower && (!events || events.length === 0)) {
    return null;
  }

  const staleSeconds = status?.house?.lastSampleAt
    ? Math.max(0, Math.round((Date.now() - utcDate(status.house.lastSampleAt).getTime()) / 1000))
    : null;
  const isStale = staleSeconds !== null && staleSeconds > 60;
  const dotColor = !status?.mqttConnected
    ? 'bg-[#6b7280]'
    : isStale
      ? 'bg-[#f0a47e]'
      : 'bg-[#a7e9a7]';

  return (
    <div className="px-3 sm:px-4 pt-2 pb-3 border-t border-[#2a2a2a] select-none space-y-1.5">
      <div className="flex items-center justify-between gap-x-3 gap-y-1 flex-wrap">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColor}`} />
          <span className="text-[11px] sm:text-xs text-[#9ca3af] uppercase tracking-wider">
            {t('home.power.house')}
          </span>
          <span className="text-sm font-semibold text-[#e0e0e0] tabular-nums">
            {hasPower ? `${va.toLocaleString()} ${unit}` : '—'}
          </span>
        </div>
        {hasTeslaPower && (
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-[11px] sm:text-xs text-[#9ca3af] uppercase tracking-wider">
              {t('home.power.tesla')}
            </span>
            <span className="text-sm font-semibold text-[#7eb8f0] tabular-nums">
              {teslaVa.toLocaleString()} {unit}
            </span>
          </div>
        )}
      </div>

      {events && events.length > 0 && (
        <ul className="space-y-1">
          {events.slice(0, 2).map((e) => {
            const d = utcDate(e.at);
            const when = `${d.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit' })} ${d.toLocaleTimeString(
              undefined,
              { hour: '2-digit', minute: '2-digit' },
            )}`;
            const palette = PILL_PALETTE[e.kind] ?? { bg: 'bg-[#1a1a1a]', text: 'text-[#9ca3af]' };
            const summary = [
              e.fromAmps != null && e.toAmps != null
                ? t('loadShedding.events.arrowAmps', { from: e.fromAmps, to: e.toAmps })
                : null,
              e.detail || null,
            ]
              .filter(Boolean)
              .join(' · ');
            return (
              <li key={e.id} className="flex items-center gap-2 text-[11px] min-w-0">
                <span className="text-[#6b7280] tabular-nums shrink-0 w-[5.5rem]">{when}</span>
                <span
                  className={`text-[9px] px-1.5 py-0.5 rounded uppercase tracking-wider shrink-0 ${palette.bg} ${palette.text}`}
                >
                  {e.kind}
                </span>
                <span className="text-[#9ca3af] truncate">{summary}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
