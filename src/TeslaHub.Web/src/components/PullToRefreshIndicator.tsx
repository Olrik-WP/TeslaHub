import type { PullToRefreshState } from '../hooks/usePullToRefresh';

interface Props {
  state: PullToRefreshState;
}

/**
 * Tiny indicator pinned just above the page content. Slides down with
 * the user's finger and flips the chevron once `ready` (past the
 * trigger distance), then spins while the refresh promise is in flight.
 *
 * Rendered at the very top of the page's scroll body so its translate
 * effect doesn't push fixed/sticky chrome around. The page is
 * responsible for placing it before any other element.
 */
export default function PullToRefreshIndicator({ state }: Props) {
  const { distance, refreshing, ready } = state;
  const visible = distance > 0 || refreshing;

  return (
    <div
      aria-hidden
      style={{
        height: visible ? `${Math.max(0, distance)}px` : '0px',
        transition: refreshing || distance > 0 ? 'none' : 'height 200ms ease',
      }}
      className="flex items-end justify-center overflow-hidden pointer-events-none"
    >
      {visible && (
        <div
          className="flex items-center justify-center pb-2 text-[#9ca3af]"
          style={{
            opacity: Math.min(1, distance / 50),
            transform: `scale(${Math.min(1, 0.6 + distance / 120)})`,
            transition: refreshing ? 'transform 200ms ease' : 'none',
          }}
        >
          {refreshing ? (
            <Spinner />
          ) : (
            <Chevron flipped={ready} />
          )}
        </div>
      )}
    </div>
  );
}

function Chevron({ flipped }: { flipped: boolean }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{
        transform: `rotate(${flipped ? 180 : 0}deg)`,
        transition: 'transform 180ms ease',
      }}
    >
      <path d="M12 5v14M5 12l7 7 7-7" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      className="animate-spin"
    >
      <path d="M21 12a9 9 0 1 1-3.5-7.1" />
    </svg>
  );
}
