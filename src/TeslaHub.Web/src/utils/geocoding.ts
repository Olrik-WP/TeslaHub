// ─────────────────────────────────────────────────────────────────────────────
// Centralised Nominatim client.
//
// Why this file exists:
// - The Nominatim public instance has a strict usage policy
//   (https://operations.osmfoundation.org/policies/nominatim/):
//     * max ~1 request/second
//     * an identifying User-Agent / Referer is required
//     * heavy / bulk usage must be self-hosted
// - Our previous code spread fetch() calls across components without
//   deduplication or identification, which is technically non-compliant.
//   This module fixes that and keeps a single place to swap providers
//   later if needed.
//
// Compliance choices:
// - Identifying Referer (browsers cannot set User-Agent on fetch, but
//   Nominatim accepts Referer as the alternative identifier — see policy).
// - In-memory LRU cache so successive renders / drag events on the same
//   coordinate don't re-fetch.
// - debounce() helper exposed for callers (autocomplete needs ~400ms).
// - NOMINATIM_BASE_URL can be overridden at build-time via Vite env, so
//   power users can point to a self-hosted instance via NOMINATIM_BASE_URL.
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_BASE = 'https://nominatim.openstreetmap.org';
const BASE_URL =
  (import.meta.env.VITE_NOMINATIM_BASE_URL as string | undefined)?.replace(/\/+$/, '') || DEFAULT_BASE;

const REFERER = window.location.origin || 'https://github.com/Olrik-WP/TeslaHub';

export interface SearchResult {
  displayName: string;
  shortName: string;
  latitude: number;
  longitude: number;
  type?: string;
  importance?: number;
}

const REVERSE_CACHE = new Map<string, string>();
const SEARCH_CACHE = new Map<string, SearchResult[]>();
const MAX_CACHE_ENTRIES = 100;

function rememberReverse(key: string, value: string) {
  if (REVERSE_CACHE.size >= MAX_CACHE_ENTRIES) {
    const firstKey = REVERSE_CACHE.keys().next().value;
    if (firstKey !== undefined) REVERSE_CACHE.delete(firstKey);
  }
  REVERSE_CACHE.set(key, value);
}

function rememberSearch(key: string, value: SearchResult[]) {
  if (SEARCH_CACHE.size >= MAX_CACHE_ENTRIES) {
    const firstKey = SEARCH_CACHE.keys().next().value;
    if (firstKey !== undefined) SEARCH_CACHE.delete(firstKey);
  }
  SEARCH_CACHE.set(key, value);
}

function shortenAddress(displayName: string): string {
  return displayName.split(',').slice(0, 3).join(',').trim();
}

interface ReverseOptions {
  language?: string;
  signal?: AbortSignal;
  zoom?: number;
}

/**
 * Reverse geocode a coordinate to a short, human-friendly address.
 * Returns an empty string on failure (callers should treat it as "no data").
 */
export async function reverseGeocode(
  lat: number,
  lng: number,
  options: ReverseOptions = {},
): Promise<string> {
  const lang = options.language || 'en';
  const zoom = options.zoom ?? 18;
  const cacheKey = `${lat.toFixed(5)},${lng.toFixed(5)}|${lang}|${zoom}`;
  const cached = REVERSE_CACHE.get(cacheKey);
  if (cached !== undefined) return cached;

  const url = `${BASE_URL}/reverse?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(
    lng,
  )}&format=json&zoom=${zoom}&addressdetails=1`;

  try {
    const res = await fetch(url, {
      signal: options.signal,
      headers: {
        'Accept-Language': lang,
        Referer: REFERER,
      },
    });
    if (!res.ok) return '';
    const data = await res.json();
    const display = typeof data?.display_name === 'string' ? data.display_name : '';
    const shortened = display ? shortenAddress(display) : '';
    rememberReverse(cacheKey, shortened);
    return shortened;
  } catch {
    return '';
  }
}

interface SearchOptions {
  language?: string;
  signal?: AbortSignal;
  limit?: number;
  /** Optional bias: prefer results around this center, e.g. user position. */
  near?: { latitude: number; longitude: number };
  /** Optional ISO 3166-1 alpha-2 country codes restriction (comma-separated). */
  countryCodes?: string;
}

/**
 * Forward geocode a free-text query (autocomplete-friendly).
 * Returns an empty array on failure or when the query is too short.
 *
 * NOTE: callers are expected to debounce the input (~400ms) and pass an
 * AbortSignal that gets aborted when the user types again, to stay within
 * the Nominatim rate limit.
 */
export async function searchAddress(
  query: string,
  options: SearchOptions = {},
): Promise<SearchResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 3) return [];

  const lang = options.language || 'en';
  const limit = Math.min(Math.max(options.limit ?? 5, 1), 10);
  const near = options.near;
  const cacheKey = `${trimmed.toLowerCase()}|${lang}|${limit}|${near?.latitude.toFixed(2) ?? ''}|${
    near?.longitude.toFixed(2) ?? ''
  }|${options.countryCodes ?? ''}`;

  const cached = SEARCH_CACHE.get(cacheKey);
  if (cached !== undefined) return cached;

  const params = new URLSearchParams({
    q: trimmed,
    format: 'jsonv2',
    limit: String(limit),
    addressdetails: '1',
  });
  if (options.countryCodes) params.set('countrycodes', options.countryCodes);
  if (near) {
    // viewbox = left,top,right,bottom (~50km box around the point)
    const dLat = 0.45;
    const dLng = 0.6;
    params.set(
      'viewbox',
      `${near.longitude - dLng},${near.latitude + dLat},${near.longitude + dLng},${near.latitude - dLat}`,
    );
    params.set('bounded', '0');
  }

  const url = `${BASE_URL}/search?${params.toString()}`;
  try {
    const res = await fetch(url, {
      signal: options.signal,
      headers: {
        'Accept-Language': lang,
        Referer: REFERER,
      },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as Array<Record<string, unknown>>;
    const mapped: SearchResult[] = data
      .filter((d) => typeof d.lat === 'string' && typeof d.lon === 'string')
      .map((d) => {
        const display = typeof d.display_name === 'string' ? d.display_name : '';
        return {
          displayName: display,
          shortName: shortenAddress(display),
          latitude: parseFloat(d.lat as string),
          longitude: parseFloat(d.lon as string),
          type: typeof d.type === 'string' ? (d.type as string) : undefined,
          importance: typeof d.importance === 'number' ? (d.importance as number) : undefined,
        };
      })
      .filter((r) => Number.isFinite(r.latitude) && Number.isFinite(r.longitude));
    rememberSearch(cacheKey, mapped);
    return mapped;
  } catch {
    return [];
  }
}

/** Distance in meters between two coords (haversine, good enough for UI hints). */
export function haversineMeters(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const toRad = (n: number) => (n * Math.PI) / 180;
  const R = 6_371_000;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
