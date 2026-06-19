/**
 * Per-vehicle accent colour resolver.
 *
 * The colour is meant to differentiate cars at a glance in multi-car
 * setups (e.g. the vehicle switcher pills). Resolution chain — first
 * non-empty source wins:
 *
 *   1. `bodyPaintColor` saved in the Showroom config for this car
 *      (the user explicitly picked a paint in /showroom). Stored as
 *      a 24-bit hex integer in `CarShowroomConfigs.ConfigJson`.
 *
 *   2. Tesla `exteriorColor` code from TeslaMate's `vehicle_config`
 *      (`PPSW`, `PMNG`, `PPMR`…). Mapped to a representative CSS hex
 *      via `TESLA_COLOR_HEX`. Non-exhaustive on purpose — any unknown
 *      code falls through to (3).
 *
 *   3. Tesla red (`#e31937`). The default when neither source has
 *      anything usable, keeping the UI looking intentional rather
 *      than reverting to a flat grey.
 *
 * This file is pure (no React, no fetch). The hook plugs into the
 * existing Showroom React Query cache via `useResolvedModelConfig`,
 * so adding accent colours to N pills costs zero extra HTTP requests
 * beyond what the 3D viewer already triggers.
 */
import type { VehicleStatus } from '../api/queries';
import { useResolvedModelConfig } from '../components/useResolvedModelConfig';
import { selectModelOverrides } from '../components/showroomOverrides';

/**
 * Tesla exterior color codes seen in TeslaMate's `vehicle_config`
 * dump (and their plain-English aliases occasionally surfaced by the
 * Fleet API). Mapped to a representative CSS hex. We deliberately do
 * not try to match the exact PBR-correct paint — a recognizable hue
 * is enough for a pill swatch, and the user can override per-car via
 * the Showroom paint picker if they want pixel-accurate.
 */
const TESLA_COLOR_HEX: Record<string, string> = {
  // Whites
  PPSW: '#f2f2f0', // Pearl White Multi-Coat
  PSWH: '#f2f2f0', // Solid White
  DSWH: '#f2f2f0',
  WHITE: '#f2f2f0',

  // Blacks
  PBSB: '#0e0e0e', // Solid Black
  DSBL: '#0e0e0e',
  BLACK: '#0e0e0e',

  // Greys / silvers
  PMNG: '#4a4a4a', // Midnight Silver Metallic
  MSSG: '#4a4a4a',
  DSGY: '#4a4a4a',
  GREY: '#4a4a4a',
  GRAY: '#4a4a4a',
  PMSS: '#a8a8a8', // older Silver
  SILVER: '#a8a8a8',
  STEALTH: '#4d5158', // Stealth Grey (Highland 2025+)
  QSILVER: '#bcc1c4', // Quicksilver (Highland)

  // Reds
  PPMR: '#a82323', // Multi-Coat Red
  PSRD: '#a82323',
  RED: '#a82323',
  USRD: '#c4101b', // Ultra Red (Highland)

  // Blues
  DBPB: '#1b3a5c', // Deep Blue Metallic
  PMBL: '#1b3a5c',
  PPBL: '#1b3a5c',
  BLUE: '#1b3a5c',
};

/** Tesla red — same hue used as primary brand colour across the app. */
const DEFAULT_ACCENT = '#e31937';

export type AccentSource = 'showroom' | 'tesla' | 'default';

export interface AccentColor {
  hex: string;
  source: AccentSource;
}

/**
 * Stringify a 24-bit hex integer (0x000000–0xffffff) into a CSS hex
 * string `#rrggbb`. Returns `null` for nullish input.
 */
function hexNumToString(n: number | undefined | null): string | null {
  if (n == null) return null;
  const v = (n & 0xffffff).toString(16).padStart(6, '0');
  return `#${v}`;
}

/**
 * Resolve the accent colour for a car. Order of preference:
 *   1. Showroom-saved `bodyPaintColor` for this car
 *   2. Tesla `exteriorColor` code mapping
 *   3. Default Tesla red
 */
export function useVehicleAccentColor(
  carId: number | undefined | null,
  status: VehicleStatus | undefined,
): AccentColor {
  // Pulls the persisted Showroom override blob via the shared React
  // Query cache (same key the 3D viewer uses — already deduped). The
  // blob is namespaced by model (v2), so we slice out the active
  // model's slot before reading its `bodyPaintColor` override.
  const vin = status?.vin ?? null;
  const { savedOverrides } = useResolvedModelConfig(carId, vin);
  const activeOverrides = selectModelOverrides(savedOverrides, vin);

  const showroomHex = hexNumToString(activeOverrides.bodyPaintColor ?? null);
  if (showroomHex) return { hex: showroomHex, source: 'showroom' };

  const code = status?.exteriorColor?.toUpperCase();
  if (code && TESLA_COLOR_HEX[code]) {
    return { hex: TESLA_COLOR_HEX[code], source: 'tesla' };
  }

  return { hex: DEFAULT_ACCENT, source: 'default' };
}

/**
 * Relative luminance per WCAG (sRGB → linear → weighted). Output 0..1.
 * Used to decide whether white or dark text is more readable on top
 * of the accent colour.
 */
export function accentLuminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return 0;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 0xff) / 255;
  const g = ((n >> 8) & 0xff) / 255;
  const b = (n & 0xff) / 255;
  const lin = (c: number) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/**
 * Pick a readable text colour for foreground on top of the accent.
 * Threshold 0.45 is empirically tuned for the dark TeslaHub theme:
 * it favours white text on mid-tone accents (Tesla red, Deep Blue,
 * Multi-Coat Red…) and only flips to dark text on genuinely light
 * accents (Pearl White, Quicksilver).
 */
export function accentTextColor(hex: string): '#0a0a0a' | '#ffffff' {
  return accentLuminance(hex) > 0.45 ? '#0a0a0a' : '#ffffff';
}
