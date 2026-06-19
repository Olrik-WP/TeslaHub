/**
 * Shared GLB-availability probe with a per-session cache.
 *
 * Returns:
 *   - `null`  while the probe for the current URL is in flight (or the
 *             URL just changed and we haven't probed the new one yet).
 *   - `true`  once the asset is confirmed reachable (200/206, binary).
 *   - `false` once it's confirmed missing / served as the SPA HTML
 *             fallback (Caddy returns index.html for unknown routes).
 *
 * Caching: a deployed build serves a STATIC set of assets, so a model
 * GLB is either present for the whole session or not. We therefore cache
 * the result per URL — unlike the supercharger/handle probe in
 * VehicleTopView3D which deliberately re-probes (a file can be dropped
 * into a mounted /models volume between requests). This keeps the
 * community-fallback decision cheap (one probe per URL, app-wide).
 */
import { useEffect, useState } from 'react';

const cache = new Map<string, boolean>();
const inflight = new Map<string, Promise<boolean>>();

const isUsable = (status: number, contentType: string): boolean =>
  (status === 200 || status === 206) &&
  !contentType.startsWith('text/') &&
  !contentType.includes('text/html');

async function probe(url: string): Promise<boolean> {
  const cached = cache.get(url);
  if (cached !== undefined) return cached;

  let pending = inflight.get(url);
  if (!pending) {
    pending = (async () => {
      try {
        const head = await fetch(url, { method: 'HEAD', cache: 'no-store' });
        if (isUsable(head.status, head.headers.get('content-type') ?? '')) {
          return true;
        }
        // Some proxies mishandle HEAD — fall back to a tiny ranged GET.
        const get = await fetch(url, {
          headers: { Range: 'bytes=0-15' },
          cache: 'no-store',
        });
        return isUsable(get.status, get.headers.get('content-type') ?? '');
      } catch {
        return false;
      }
    })()
      .then((ok) => {
        cache.set(url, ok);
        return ok;
      })
      .finally(() => inflight.delete(url));
    inflight.set(url, pending);
  }
  return pending;
}

export function useGlbAvailable(url: string | undefined): boolean | null {
  const [state, setState] = useState<{ url: string; ok: boolean } | null>(() =>
    url && cache.has(url) ? { url, ok: cache.get(url)! } : null,
  );

  useEffect(() => {
    if (!url) return;
    const cached = cache.get(url);
    if (cached !== undefined) {
      setState({ url, ok: cached });
      return;
    }
    let cancelled = false;
    probe(url).then((ok) => {
      if (!cancelled) setState({ url, ok });
    });
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (!url) return null;
  return state && state.url === url ? state.ok : null;
}
