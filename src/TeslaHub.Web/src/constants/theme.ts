/**
 * Centralized UI constants used across the app.
 * Tailwind classes are still inlined (`bg-[#141414]`) because Tailwind needs
 * the literal class names at build time, but the underlying color values are
 * exposed here so non-Tailwind consumers (charts, inline SVG, etc.) stay in sync.
 */

export const COLORS = {
  /** TeslaHub brand red — primary buttons, active filters. */
  brand: '#e31937',
  brandActive: '#c0152f',

  /** Background tones (darkest → lightest). */
  bg: '#0a0a0a',
  surface: '#141414',
  surfaceMuted: '#1a1a1a',
  border: '#2a2a2a',

  /** Status / accent colors used in charts and badges. */
  success: '#22c55e',
  warning: '#eab308',
  danger: '#ef4444',
  info: '#3b82f6',
  infoActive: '#2563eb',
  dc: '#f59e0b',

  /** Foreground tones. */
  textMuted: '#9ca3af',
  textSubtle: '#6b7280',
  textFaint: '#4b5563',
} as const;

/**
 * TanStack Query stale times (ms). Use these named values instead of inlining
 * raw numbers so we can tune cache behavior in one place.
 */
export const STALE_TIME = {
  /** Live-ish data (vehicle status, charging sessions list). */
  live: 30_000,
  /** Slowly-changing data (charging history, drives). */
  history: 2 * 60_000,
  /** Practically static data (release info, settings). */
  staticHour: 60 * 60_000,
} as const;

/**
 * Practical fetch limits.
 */
export const LIMITS = {
  /** Max charging sessions pulled in a single page-level fetch. */
  chargingSessionsPage: 500,
} as const;
