import type { ReactNode } from 'react';

/**
 * Compact horizontal tile used in the Control tile-grid layout.
 *
 * Layout (left → right):
 *   [icon]  [title + subtitle]   [badge?]   [chevron]
 *
 * The tile is the entire interactive surface (button) — the whole row
 * is tappable on mobile, which matches the maquette's "list with
 * trailing chevron" pattern (Tesla / Apple Settings style).
 *
 * Status text (PR-2 leaves the `subtitle` slot empty) will be wired
 * in PR-3 from the live VehicleStatus + snapshot data, e.g.
 *   primary: "Inactive" / "Charging" / "Verrouillé"
 *   secondary: "22°C" / "Limite 81%"
 *   tertiary: "Int. 35°C" / "Débranché"
 *
 * Badge is reserved for an at-a-glance health signal (e.g. red dot
 * when a door is open or the cabin overheats), independent of the
 * subtitle text.
 */
export interface ControlTileProps {
  icon: ReactNode;
  title: string;
  /** Optional one-line summary, e.g. "22.0°C · Int. 35°C · Inactif" */
  subtitle?: ReactNode;
  /** Optional trailing tag (e.g. green dot for "OK", red dot for alert). */
  badge?: ReactNode;
  /** Whether to render a chevron at the end — defaults to true. */
  showChevron?: boolean;
  /** Disable the tile and dim it visually (e.g. capability missing). */
  disabled?: boolean;
  onClick: () => void;
  /** Optional aria-label / title fallback when no subtitle is set. */
  ariaLabel?: string;
}

export default function ControlTile({
  icon,
  title,
  subtitle,
  badge,
  showChevron = true,
  disabled = false,
  onClick,
  ariaLabel,
}: ControlTileProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel ?? title}
      className={`group w-full flex items-center gap-3 bg-[#141414] border border-[#2a2a2a] rounded-xl px-4 py-3 text-left transition-colors duration-150 ${
        disabled
          ? 'opacity-50 cursor-not-allowed'
          : 'active:bg-[#1a1a1a] hover:border-[#3a3a3a]'
      }`}
    >
      <span
        aria-hidden="true"
        className="flex-shrink-0 w-9 h-9 rounded-lg bg-[#0a0a0a] border border-[#2a2a2a] flex items-center justify-center text-[#e0e0e0]"
      >
        {icon}
      </span>

      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-[#e0e0e0] truncate">{title}</div>
        {subtitle && (
          <div className="text-[11px] text-[#9ca3af] truncate mt-0.5">
            {subtitle}
          </div>
        )}
      </div>

      {badge && <span className="flex-shrink-0">{badge}</span>}

      {showChevron && (
        <svg
          aria-hidden="true"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-[#6b7280] flex-shrink-0 transition-transform group-active:translate-x-0.5"
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
      )}
    </button>
  );
}
