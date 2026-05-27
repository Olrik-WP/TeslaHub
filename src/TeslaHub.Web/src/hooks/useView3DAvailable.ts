import { useEffect, useState } from 'react';

// Public path served by Caddy — the operator mounts the proprietary GLB
// here via docker-compose volume. Same probe used by VehicleTopView.
const MODEL_PROBE_URL = '/models/poppyseed.glb';

function detectWebGL(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    return !!(
      window.WebGLRenderingContext &&
      (canvas.getContext('webgl2') || canvas.getContext('webgl'))
    );
  } catch {
    return false;
  }
}

/**
 * Single source of truth for "can we render the interactive 3D viewer
 * right now?". Combines two checks:
 *
 *   1. WebGL is supported by this browser (probed synchronously on mount).
 *   2. The Tesla GLB asset is reachable behind the static server (HEAD
 *      probe, async). Caddy serves `index.html` for unknown paths via
 *      try_files, so we reject any text/* response as a false positive.
 *
 * Both must be true to return `true`. While the async probe is still
 * pending we return `null` — callers can distinguish "still loading"
 * from "definitely no 3D" and avoid flashing the SVG fallback for a
 * frame.
 *
 * The HEAD request is cached at the HTTP layer (`force-cache`), and the
 * hook only fires it once per page load — even if multiple components
 * call the hook simultaneously, the browser will dedupe.
 */
export function useView3DAvailable(): boolean | null {
  const [webglSupported] = useState(detectWebGL);
  const [modelAvailable, setModelAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    if (!webglSupported) {
      setModelAvailable(false);
      return;
    }
    let cancelled = false;
    fetch(MODEL_PROBE_URL, { method: 'HEAD', cache: 'force-cache' })
      .then((r) => {
        if (cancelled) return;
        const ct = r.headers.get('content-type') ?? '';
        setModelAvailable(r.ok && !ct.startsWith('text/'));
      })
      .catch(() => {
        if (!cancelled) setModelAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, [webglSupported]);

  if (!webglSupported) return false;
  if (modelAvailable === null) return null;
  return modelAvailable;
}
