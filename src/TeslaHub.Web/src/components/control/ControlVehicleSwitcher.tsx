import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { getCars } from '../../api/queries';
import { useVehicleStatus } from '../../hooks/useVehicle';
import type { VehicleStatus } from '../../api/queries';

interface Props {
  selectedCarId: number | undefined;
  onChange: (id: number) => void;
  /** Pre-resolved title for the active vehicle (Tesla Fleet display name fallback). */
  activeLabel: string;
}

/**
 * Compact car switcher embedded in the Control page sticky header.
 *
 * Why it exists:
 * The global CarSelector lives at the very top of the layout and
 * scrolls away with the rest of the page. On a long Control page
 * (climate + charge + access + openings + media + software + …) the
 * user can easily forget which car is being controlled when they
 * scroll down to e.g. the seat heaters. This switcher stays visible
 * inside the header so:
 *   - the active vehicle name + state dot are always shown,
 *   - tapping the title opens a small menu listing every vehicle
 *     with its live state, so the user can switch without scrolling
 *     all the way back to the top.
 *
 * Visually unobtrusive: when there's only one car (or cars haven't
 * loaded yet), it renders as a plain text label — no chevron, no
 * affordance — so single-car users see no extra UI at all.
 */
export default function ControlVehicleSwitcher({ selectedCarId, onChange, activeLabel }: Props) {
  const { t } = useTranslation();
  const { data: cars } = useQuery({ queryKey: ['cars'], queryFn: getCars });
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  // Close the menu on outside click / Escape so it never traps the user.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const activeStatus = useVehicleStatus(selectedCarId);
  const activeIndicator = stateIndicator(activeStatus.data, t);

  const multiple = (cars?.length ?? 0) > 1;

  return (
    <div ref={ref} className="relative min-w-0">
      <button
        type="button"
        onClick={() => multiple && setOpen((v) => !v)}
        disabled={!multiple}
        className={[
          'flex items-center gap-2 max-w-full text-left',
          multiple ? 'cursor-pointer' : 'cursor-default',
        ].join(' ')}
        title={activeIndicator.title}
        aria-haspopup={multiple ? 'menu' : undefined}
        aria-expanded={multiple ? open : undefined}
      >
        <span
          aria-hidden="true"
          className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${activeIndicator.dotClass} ${
            activeIndicator.pulse ? 'animate-pulse' : ''
          }`}
        />
        <h1 className="text-base font-semibold text-[#e0e0e0] truncate">{activeLabel}</h1>
        {multiple && (
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`text-[#6b7280] flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        )}
      </button>

      {multiple && open && (
        <div
          role="menu"
          className="absolute z-30 left-0 mt-2 min-w-[12rem] max-w-[80vw] bg-[#141414] border border-[#2a2a2a] rounded-lg shadow-xl overflow-hidden"
        >
          {cars!.map((c) => (
            <SwitcherRow
              key={c.id}
              carId={c.id}
              label={c.name || c.marketingName || c.model || `Car ${c.id}`}
              active={c.id === selectedCarId}
              onPick={() => { onChange(c.id); setOpen(false); }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SwitcherRow({
  carId,
  label,
  active,
  onPick,
}: {
  carId: number;
  label: string;
  active: boolean;
  onPick: () => void;
}) {
  const { t } = useTranslation();
  const { data: status } = useVehicleStatus(carId);
  const indicator = stateIndicator(status, t);
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onPick}
      className={[
        'flex items-center gap-2 w-full text-left px-3 py-2 text-sm border-b border-[#1a1a1a] last:border-b-0',
        active ? 'bg-[#e31937]/10 text-white' : 'text-[#9ca3af] hover:bg-[#1a1a1a]',
      ].join(' ')}
      title={indicator.title}
    >
      <span
        aria-hidden="true"
        className={`inline-block w-2 h-2 rounded-full ${indicator.dotClass} ${
          indicator.pulse ? 'animate-pulse' : ''
        }`}
      />
      <span className="truncate flex-1">{label}</span>
      {active && (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      )}
    </button>
  );
}

interface Indicator {
  dotClass: string;
  pulse: boolean;
  title: string;
}

// Same logic as components/CarSelector.tsx — kept inlined to avoid a
// brittle public export and because the shapes Tesla returns evolve
// slowly enough that one source of truth here is fine. If a third
// caller needs this, lift it to src/utils/vehicleState.ts.
function stateIndicator(
  status: VehicleStatus | undefined,
  t: (key: string) => string,
): Indicator {
  if (!status) {
    return { dotClass: 'bg-[#3a3a3a]', pulse: false, title: t('carSelector.state.unknown') };
  }
  const raw = (status.state ?? '').toLowerCase();
  const charging =
    raw === 'charging' ||
    (status.chargingState ?? '').toLowerCase() === 'charging' ||
    (status.chargerPower != null && status.chargerPower > 0);
  if (charging) return { dotClass: 'bg-[#3b82f6]', pulse: true, title: t('carSelector.state.charging') };
  if (raw === 'driving' || (status.shiftState ?? '').toLowerCase() === 'd'
      || (status.shiftState ?? '').toLowerCase() === 'r')
    return { dotClass: 'bg-[#22c55e]', pulse: true, title: t('carSelector.state.driving') };
  if (raw === 'asleep') return { dotClass: 'bg-[#6b7280]', pulse: false, title: t('carSelector.state.asleep') };
  if (raw === 'offline') return { dotClass: 'bg-[#ef4444]', pulse: false, title: t('carSelector.state.offline') };
  if (raw === 'online' || raw === 'parked' || raw === '')
    return { dotClass: 'bg-[#9ca3af]', pulse: false, title: t('carSelector.state.parked') };
  return { dotClass: 'bg-[#9ca3af]', pulse: false, title: status.state ?? '' };
}
