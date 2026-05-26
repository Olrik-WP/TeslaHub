/**
 * UI preference: how the Control page is laid out.
 *
 *   - `tiles` (default) — vertical list of 6 status tiles. Each tile
 *     opens a focused drawer with the corresponding control surface.
 *     Optimised for one-handed mobile use and reduces visual noise
 *     until the user drills in.
 *   - `list` (fallback) — the historical long-scroll layout with every
 *     Card stacked. Kept as a rollback safety net during the migration
 *     and for users who genuinely prefer to see everything at once.
 *
 * Stored in `localStorage` rather than the server-side `Settings` blob
 * because it's a per-device UI preference (a user might want tiles on
 * their phone but list on their tablet/desktop). If we later decide to
 * sync it across devices, migrate this to `GlobalSettings` in one go.
 *
 * Cross-tab sync is intentional (storage event listener): toggling the
 * layout in one tab should reflect immediately in the other tabs of
 * the same browser.
 */
import { useCallback, useEffect, useState } from 'react';

export type ControlLayout = 'tiles' | 'list';

const STORAGE_KEY = 'teslahub:control-layout';
const DEFAULT_LAYOUT: ControlLayout = 'tiles';

function readStored(): ControlLayout {
  if (typeof window === 'undefined') return DEFAULT_LAYOUT;
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw === 'list' ? 'list' : 'tiles';
}

export function useControlLayout(): [ControlLayout, (next: ControlLayout) => void] {
  const [layout, setLayout] = useState<ControlLayout>(readStored);

  // Cross-tab / cross-component sync — when one place toggles the
  // preference, every consumer in the document re-reads from storage
  // and updates without a full reload.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      const next = e.newValue === 'list' ? 'list' : 'tiles';
      setLayout(next);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const update = useCallback((next: ControlLayout) => {
    setLayout(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
      // Manually dispatch a same-document storage event — the browser
      // only fires it for OTHER tabs, not the one that wrote. This
      // lets multiple useControlLayout() instances in the same page
      // (Settings page + Control page) stay in sync.
      window.dispatchEvent(
        new StorageEvent('storage', { key: STORAGE_KEY, newValue: next }),
      );
    } catch {
      // localStorage write can fail in private mode / quota-exceeded.
      // The in-memory state is still updated so the current tab works;
      // it just won't persist across reloads.
    }
  }, []);

  return [layout, update];
}
