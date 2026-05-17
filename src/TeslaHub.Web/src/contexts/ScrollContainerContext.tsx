import { createContext, useContext, type ReactNode, type RefObject } from 'react';

/**
 * The single inner scroll container used by AppLayout — every routed
 * page renders inside it. Pages that want to register a gesture (e.g.
 * pull-to-refresh) need direct access to this element so they can hook
 * touch events on the actual scroll surface, not on `window` (which
 * doesn't scroll in this app — see AppLayout's explanation).
 *
 * Exposed via context so any descendant can attach listeners without
 * threading the ref through every page prop.
 */
type ScrollContainerCtx = RefObject<HTMLDivElement | null> | null;

const Context = createContext<ScrollContainerCtx>(null);

export function ScrollContainerProvider({
  scrollRef,
  children,
}: {
  scrollRef: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}) {
  return <Context.Provider value={scrollRef}>{children}</Context.Provider>;
}

/**
 * Returns the scroll container element for the current AppLayout, or
 * null when the caller is rendered outside the provider (e.g. on the
 * Login page). Hooks consuming this should no-op gracefully on null.
 */
export function useScrollContainerRef(): ScrollContainerCtx {
  return useContext(Context);
}
