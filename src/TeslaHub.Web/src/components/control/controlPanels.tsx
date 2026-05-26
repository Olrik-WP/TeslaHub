import type { ReactNode } from 'react';

/**
 * Discriminator for the 6 Control surfaces. Used as the value of the
 * `?panel=` URL search param so a deep link can land directly on a
 * specific drawer (e.g. `/control?panel=climate` from Home's quick
 * actions).
 *
 * The order here drives the visual order of the tile grid.
 */
export type PanelId =
  | 'climate'
  | 'charge'
  | 'access'
  | 'openings'
  | 'media'
  | 'software';

interface PanelDescriptor {
  id: PanelId;
  /** i18n key for the tile title + drawer header. Reuses existing
   *  `control.<panel>.title` keys so we don't fragment translations. */
  titleKey: string;
  icon: ReactNode;
}

// ─── Tile icons ───────────────────────────────────────────────────────────
// Slightly larger (20×20) than the Card-header icons (18×18) so they
// read clearly inside the 36×36 rounded tile badge. Stroke width and
// stroke style match the rest of the inline-SVG icon set used across
// the app — no icon library dependency.

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

const ClimateIcon = (
  <Icon>
    <path d="M12 3v18M5 7l14 10M5 17 19 7" />
    <path d="M12 3l-2 2M12 3l2 2M12 21l-2-2M12 21l2-2" />
  </Icon>
);

const ChargeIcon = (
  <Icon>
    <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" />
  </Icon>
);

const AccessIcon = (
  <Icon>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </Icon>
);

const OpeningsIcon = (
  <Icon>
    <path d="M3 12h18M5 12V8a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v4M7 16v3M17 16v3" />
  </Icon>
);

const MediaIcon = (
  <Icon>
    <path d="M9 18V5l12-2v13" />
    <circle cx="6" cy="18" r="3" />
    <circle cx="18" cy="16" r="3" />
  </Icon>
);

const SoftwareIcon = (
  <Icon>
    <path d="M12 16V4M8 12l4 4 4-4" />
    <path d="M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2" />
  </Icon>
);

/**
 * Single source of truth for the panel list. Both the tile grid and
 * the drawer iterate over this — adding a 7th panel only requires:
 *   1. A new PanelId literal above
 *   2. A descriptor here (with i18n key + icon)
 *   3. The actual Card content rendered in ControlDrawer's switch
 */
export const PANEL_IDS: ReadonlyArray<PanelDescriptor> = [
  { id: 'climate', titleKey: 'control.climate.title', icon: ClimateIcon },
  { id: 'charge', titleKey: 'control.charge.title', icon: ChargeIcon },
  { id: 'access', titleKey: 'control.access.title', icon: AccessIcon },
  { id: 'openings', titleKey: 'control.openings.title', icon: OpeningsIcon },
  { id: 'media', titleKey: 'control.media.title', icon: MediaIcon },
  { id: 'software', titleKey: 'control.software.title', icon: SoftwareIcon },
];

/** Type guard to validate a string from the URL against the union. */
export function isPanelId(v: string | null | undefined): v is PanelId {
  return (
    v === 'climate' ||
    v === 'charge' ||
    v === 'access' ||
    v === 'openings' ||
    v === 'media' ||
    v === 'software'
  );
}
