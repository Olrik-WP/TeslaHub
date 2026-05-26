import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { VehicleStatus } from '../../api/queries';
import type {
  VehicleStateSnapshot,
  VehicleCapabilities,
} from '../../hooks/useVehicleControl';
import { useScrollContainerRef } from '../../contexts/ScrollContainerContext';
import { PANEL_IDS, type PanelId } from './controlPanels';
import ClimateCard from './ClimateCard';
import ChargeCard from './ChargeCard';
import AccessCard from './AccessCard';
import OpeningsCard from './OpeningsCard';
import MediaCard from './MediaCard';
import SoftwareCard from './SoftwareCard';

interface Props {
  panel: PanelId;
  vehicleId: number;
  snapshot: VehicleStateSnapshot | undefined;
  vehicleStatus: VehicleStatus | undefined;
  capabilities: VehicleCapabilities;
  online: boolean;
  /** Called when the user dismisses the drawer (X button, backdrop
   *  click, Escape key). The Control page reflects this back into the
   *  URL by removing `?panel=`. */
  onClose: () => void;
}

/**
 * Generic Control drawer.
 *
 *   - Mobile (< 640 px): bottom-sheet that slides up from the bottom,
 *     ~90 % of viewport height, rounded top edge.
 *   - Desktop (≥ 640 px): side-sheet anchored to the right edge,
 *     480 px wide, full viewport height.
 *
 * URL-driven mount (the `panel` prop is derived from `?panel=` by the
 * Control page) — so the browser back button closes the drawer for
 * free, and a deep link from anywhere lands on the right section.
 *
 * Side effects while mounted:
 *   - Locks `document.body` overflow (no page scroll behind the sheet).
 *   - Listens for Escape and routes it to `onClose`.
 *   - Auto-focuses the close button on open for keyboard users.
 *
 * Animation: the drawer mounts off-screen and slides in on the next
 * tick. There is no exit animation (the close action unmounts the
 * component instantly via the URL) — kept intentional because mobile
 * users expect immediate feedback when they dismiss a sheet.
 */
export default function ControlDrawer({
  panel,
  vehicleId,
  snapshot,
  vehicleStatus,
  capabilities,
  online,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const scrollRef = useScrollContainerRef();

  // Slide-in: start off-screen, flip to on-screen on the next frame
  // so the CSS transition can interpolate. useLayoutEffect runs after
  // the DOM commit but BEFORE paint, so the user never sees a flash
  // of the panel at its open position.
  const [open, setOpen] = useState(false);
  useLayoutEffect(() => {
    // Defer one frame so the initial transform has a chance to paint
    // before the transition triggers. Required on iOS Safari where
    // setting transform synchronously in the same commit cancels the
    // animation entirely.
    const id = requestAnimationFrame(() => setOpen(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // Scroll lock — this app scrolls inside a dedicated `<div>` (see
  // ScrollContainerProvider), not the document body. Locking `body`
  // would be a no-op, so we lock the actual scroll container and
  // restore its previous overflow on unmount.
  useEffect(() => {
    const el = scrollRef?.current;
    if (!el) return;
    const prev = el.style.overflowY;
    el.style.overflowY = 'hidden';
    return () => {
      el.style.overflowY = prev;
    };
  }, [scrollRef]);

  // Escape key dismissal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Keyboard accessibility — drop focus on the close button so a
  // screen-reader user lands inside the dialog. Skip the autofocus
  // dance on touch devices to avoid the keyboard popping up.
  useEffect(() => {
    if (typeof navigator !== 'undefined' && /Mobi/i.test(navigator.userAgent)) return;
    closeBtnRef.current?.focus();
  }, [panel]);

  const descriptor = useMemo(
    () => PANEL_IDS.find((p) => p.id === panel),
    [panel],
  );

  return (
    <>
      {/* Backdrop — covers the whole viewport. Click anywhere outside
          the sheet dismisses the drawer. Opacity transitions in tandem
          with the sheet for a coherent visual. */}
      <button
        type="button"
        onClick={onClose}
        aria-label={t('control.drawer.close')}
        className={`fixed inset-0 z-40 bg-black/60 transition-opacity duration-200 ${
          open ? 'opacity-100' : 'opacity-0'
        }`}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="control-drawer-title"
        className={`fixed z-50 bg-[#0a0a0a] flex flex-col shadow-2xl
          inset-x-0 bottom-0 max-h-[92vh] rounded-t-2xl
          sm:inset-y-0 sm:right-0 sm:left-auto sm:w-[480px] sm:max-h-none sm:h-full sm:rounded-t-none sm:rounded-l-2xl
          transition-transform duration-200 ease-out
          ${open
            ? 'translate-y-0 sm:translate-x-0'
            : 'translate-y-full sm:translate-y-0 sm:translate-x-full'}`}
      >
        {/* Drag handle (mobile only) — purely visual; no actual swipe
            gesture wired yet. Reads as "Tesla bottom-sheet" idiom. */}
        <div
          aria-hidden="true"
          className="sm:hidden flex justify-center pt-2 pb-1 flex-shrink-0"
        >
          <span className="block w-10 h-1 rounded-full bg-[#3a3a3a]" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-[#1a1a1a] flex-shrink-0">
          <h2
            id="control-drawer-title"
            className="text-base font-semibold text-[#e0e0e0] flex items-center gap-2 min-w-0 truncate"
          >
            <span aria-hidden="true" className="text-[#9ca3af]">
              {descriptor?.icon}
            </span>
            <span className="truncate">
              {descriptor ? t(descriptor.titleKey) : panel}
            </span>
          </h2>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            aria-label={t('control.drawer.close')}
            className="flex-shrink-0 w-9 h-9 rounded-lg border border-[#2a2a2a] text-[#9ca3af] hover:text-white hover:border-[#3a3a3a] active:bg-[#1a1a1a] flex items-center justify-center transition-colors"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Body — the existing Card is reused as-is so feature parity
            is identical to the legacy list layout. */}
        <div className="flex-1 overflow-y-auto px-3 py-3">
          <DrawerBody
            panel={panel}
            vehicleId={vehicleId}
            snapshot={snapshot}
            vehicleStatus={vehicleStatus}
            capabilities={capabilities}
            online={online}
          />
        </div>
      </div>
    </>
  );
}

interface BodyProps {
  panel: PanelId;
  vehicleId: number;
  snapshot: VehicleStateSnapshot | undefined;
  vehicleStatus: VehicleStatus | undefined;
  capabilities: VehicleCapabilities;
  online: boolean;
}

function DrawerBody({
  panel,
  vehicleId,
  snapshot,
  vehicleStatus,
  capabilities,
  online,
}: BodyProps) {
  switch (panel) {
    case 'climate':
      return (
        <ClimateCard
          vehicleId={vehicleId}
          snapshot={snapshot}
          vehicleStatus={vehicleStatus}
          capabilities={capabilities}
          online={online}
        />
      );
    case 'charge':
      return (
        <ChargeCard
          vehicleId={vehicleId}
          snapshot={snapshot}
          vehicleStatus={vehicleStatus}
          capabilities={capabilities}
          online={online}
        />
      );
    case 'access':
      return (
        <AccessCard
          vehicleId={vehicleId}
          snapshot={snapshot}
          vehicleStatus={vehicleStatus}
          online={online}
        />
      );
    case 'openings':
      return (
        <OpeningsCard
          vehicleId={vehicleId}
          snapshot={snapshot}
          vehicleStatus={vehicleStatus}
          capabilities={capabilities}
          online={online}
        />
      );
    case 'media':
      return <MediaCard vehicleId={vehicleId} online={online} />;
    case 'software':
      return (
        <SoftwareCard vehicleId={vehicleId} snapshot={snapshot} online={online} />
      );
  }
}
