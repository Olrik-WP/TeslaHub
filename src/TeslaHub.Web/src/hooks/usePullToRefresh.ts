import { useEffect, useRef, useState } from 'react';
import { useScrollContainerRef } from '../contexts/ScrollContainerContext';

/** Distance (px) past which a release triggers the refresh. */
const TRIGGER_DISTANCE = 70;
/** Hard ceiling on the visual indicator translation, so the user can
 *  feel a rubber-band but never drag the screen halfway down. */
const MAX_DISTANCE = 110;
/** Touch resistance: 1 = follow the finger exactly, 2 = move half as much.
 *  iOS native pull-to-refresh uses ~2.5; we mirror it so the gesture
 *  feels familiar to Tesla iOS app users who came from Safari. */
const RESISTANCE = 2.2;

export interface PullToRefreshState {
  /** Current visual pull distance in pixels (0 when idle). */
  distance: number;
  /** True while the consumer's onRefresh promise is in flight. */
  refreshing: boolean;
  /** True once the finger has dragged past TRIGGER_DISTANCE (icon flip). */
  ready: boolean;
}

/**
 * Mobile pull-to-refresh on the AppLayout scroll container. Mirrors the
 * Chrome/Safari native gesture: drag down from the top of a scrolled-
 * up page, release past the threshold to fire the refresh. iOS in
 * standalone PWA mode and inside an embedded scroll container (which
 * is our case — AppLayout owns scrolling, not the window) does NOT
 * expose a native pull-to-refresh, so we ship our own.
 *
 * The hook returns the live gesture state so the page can render a
 * matching indicator (spinner + chevron) above its content.
 *
 * @example
 * const ptr = usePullToRefresh(async () => {
 *   await qc.invalidateQueries({ queryKey: ['vehicle', carId] });
 * });
 * return <>
 *   <PullToRefreshIndicator state={ptr} />
 *   {pageContent}
 * </>
 */
export function usePullToRefresh(
  onRefresh: () => Promise<unknown> | unknown,
  options?: { enabled?: boolean },
): PullToRefreshState {
  const enabled = options?.enabled ?? true;
  const containerRef = useScrollContainerRef();
  const [distance, setDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  // Track the latest onRefresh in a ref so we don't re-attach listeners
  // every time the parent re-renders with a new closure.
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  useEffect(() => {
    if (!enabled) return;
    const el = containerRef?.current;
    if (!el) return;

    let startY: number | null = null;
    let pulling = false;
    let currentDistance = 0;

    function onTouchStart(e: TouchEvent) {
      // Only start a pull when we're at the very top of the scroll
      // container. This avoids hijacking normal scroll gestures.
      if (!el || el.scrollTop > 0) return;
      const touch = e.touches[0];
      if (!touch) return;
      startY = touch.clientY;
      pulling = false;
      currentDistance = 0;
    }

    function onTouchMove(e: TouchEvent) {
      if (startY === null) return;
      if (!el) return;
      // If the container has scrolled down since touchstart, abort —
      // user pivoted to a regular scroll instead of a pull.
      if (el.scrollTop > 0) {
        startY = null;
        if (pulling) setDistance(0);
        pulling = false;
        return;
      }
      const touch = e.touches[0];
      if (!touch) return;
      const dy = touch.clientY - startY;
      if (dy <= 0) {
        if (pulling) setDistance(0);
        pulling = false;
        return;
      }
      // Once we know the finger is heading down, claim the gesture so
      // iOS doesn't kick in its own bounce-on-overscroll, which would
      // visibly fight ours. preventDefault MUST be called on a non-
      // passive listener (see addEventListener call below).
      pulling = true;
      e.preventDefault();
      currentDistance = Math.min(MAX_DISTANCE, dy / RESISTANCE);
      setDistance(currentDistance);
    }

    async function onTouchEnd() {
      if (!pulling) {
        startY = null;
        return;
      }
      startY = null;
      pulling = false;
      const shouldFire = currentDistance >= TRIGGER_DISTANCE;
      if (!shouldFire) {
        setDistance(0);
        return;
      }
      // Pin the indicator at trigger distance while the refresh runs,
      // mirroring iOS/Chrome behaviour. The promise might be sync
      // (e.g. invalidateQueries returns a Promise<void>), might throw,
      // and might take seconds — we always reset state in finally.
      setDistance(TRIGGER_DISTANCE);
      setRefreshing(true);
      try {
        await onRefreshRef.current();
      } catch {
        // Swallow — the caller surfaces errors via toasts / query state.
      } finally {
        setRefreshing(false);
        setDistance(0);
      }
    }

    function onTouchCancel() {
      startY = null;
      pulling = false;
      setDistance(0);
    }

    // passive:false on move because we MAY call preventDefault inside
    // it. start/end/cancel stay passive (faster, no preventDefault).
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    el.addEventListener('touchcancel', onTouchCancel, { passive: true });

    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchCancel);
    };
  }, [containerRef, enabled]);

  return {
    distance,
    refreshing,
    ready: distance >= TRIGGER_DISTANCE,
  };
}
