import { type ReactNode } from 'react';

/**
 * Visual accent applied to the card header. Each Control surface picks
 * the tone that best matches its semantic — climate uses cyan (cool),
 * charge uses green (energy), access uses amber (security). The accent
 * tints the icon badge background, the optional title gradient and the
 * card's top edge — not the body, which stays neutral so the user can
 * still read dense control rows without colour fatigue.
 */
export type ControlAccent =
  | 'climate'
  | 'charge'
  | 'access'
  | 'openings'
  | 'media'
  | 'software'
  | 'neutral';

interface AccentPalette {
  /** Tint applied to the icon badge background. */
  bg: string;
  /** Foreground (icon stroke + title underline gradient). */
  fg: string;
  /** Border colour for the icon badge — semi-transparent fg. */
  border: string;
}

const ACCENTS: Record<ControlAccent, AccentPalette> = {
  // Cool blue/cyan — "AC" semantic, the cold side of the temp dial.
  climate: { bg: 'rgba(6, 182, 212, 0.10)', fg: '#22d3ee', border: 'rgba(34, 211, 238, 0.30)' },
  // Tesla-green for energy / charging.
  charge: { bg: 'rgba(34, 197, 94, 0.10)', fg: '#22c55e', border: 'rgba(34, 197, 94, 0.30)' },
  // Amber for security / valet / sentry.
  access: { bg: 'rgba(245, 158, 11, 0.10)', fg: '#f59e0b', border: 'rgba(245, 158, 11, 0.30)' },
  // Cool blue for mechanical openings (windows, frunk, trunk).
  openings: { bg: 'rgba(59, 130, 246, 0.10)', fg: '#3b82f6', border: 'rgba(59, 130, 246, 0.30)' },
  // Magenta/violet for media.
  media: { bg: 'rgba(168, 85, 247, 0.10)', fg: '#a855f7', border: 'rgba(168, 85, 247, 0.30)' },
  // Orange for software / updates (matches the legacy "warning" pill).
  software: { bg: 'rgba(245, 158, 11, 0.10)', fg: '#f59e0b', border: 'rgba(245, 158, 11, 0.30)' },
  // Fallback when the caller doesn't specify — keeps the historical look.
  neutral: { bg: 'rgba(255, 255, 255, 0.04)', fg: '#9ca3af', border: 'rgba(255, 255, 255, 0.10)' },
};

interface Props {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  badge?: ReactNode;
  children: ReactNode;
  className?: string;
  /**
   * Optional element rendered between the header and the children
   * (e.g. a big circular dial / arc). The hero slot is FULL-width and
   * centred so its visual takes precedence over the rest of the card.
   */
  hero?: ReactNode;
  /** Visual tone applied to the icon badge + the card's top edge. */
  accent?: ControlAccent;
  /** Anchor id so the per-card scroll-anchor strip can jump here. */
  id?: string;
}

/**
 * Standard card wrapper for the Control page. Mirrors the Home page
 * styling so the two pages feel like the same product
 * (bg-[#141414] / border [#2a2a2a] / rounded-xl), with an optional
 * coloured accent that gives each surface its own identity without
 * overwhelming the page.
 */
export default function ControlCard({
  title,
  subtitle,
  icon,
  badge,
  children,
  className = '',
  hero,
  accent = 'neutral',
  id,
}: Props) {
  const palette = ACCENTS[accent];

  return (
    <section
      id={id}
      className={`relative bg-[#141414] border border-[#2a2a2a] rounded-2xl p-4 overflow-hidden scroll-mt-24 ${className}`}
    >
      {/* Top-edge highlight — extra-subtle gradient that gives each
          card a tint without overwhelming the body. Sits on top of the
          card border, picks up a few px at the very top of the card. */}
      {accent !== 'neutral' && (
        <span
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-px"
          style={{
            background: `linear-gradient(90deg, transparent 0%, ${palette.fg} 50%, transparent 100%)`,
            opacity: 0.4,
          }}
        />
      )}

      <header className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-3 min-w-0">
          {icon && (
            <span
              className="shrink-0 w-9 h-9 rounded-lg flex items-center justify-center border"
              style={{
                backgroundColor: palette.bg,
                borderColor: palette.border,
                color: palette.fg,
              }}
            >
              {icon}
            </span>
          )}
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-[#e0e0e0] truncate">{title}</h2>
            {subtitle && (
              <p className="text-[11px] text-[#6b7280] truncate">{subtitle}</p>
            )}
          </div>
        </div>
        {badge && <div className="flex-shrink-0">{badge}</div>}
      </header>

      {hero && <div className="mb-3">{hero}</div>}

      {children}
    </section>
  );
}
