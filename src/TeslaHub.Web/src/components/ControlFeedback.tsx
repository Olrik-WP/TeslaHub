import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Tiny global feedback bus for Tesla command mutations. Sits at the App
 * root so both the Control page and the Home page chips can drop a
 * success/failure/waking message without each card carrying its own
 * banner. useControlMutation reads it via useControlFeedback() and
 * dispatches automatically on success / error / waking.
 *
 * Intentionally NOT a generic toast lib: scope is "the user just
 * tapped a Tesla button, tell them what happened". Auto-clears after
 * 6s, identical to SendToCarPanel's inline banner.
 */
export type FeedbackKind = 'success' | 'error' | 'waking';

export interface FeedbackMessage {
  kind: FeedbackKind;
  text: string;
}

interface ContextValue {
  show: (kind: FeedbackKind, text: string) => void;
  clear: () => void;
}

const noop = () => {};
const ControlFeedbackContext = createContext<ContextValue>({ show: noop, clear: noop });

export function useControlFeedback() {
  return useContext(ControlFeedbackContext);
}

export function ControlFeedbackProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<FeedbackMessage | null>(null);
  const timer = useRef<number | null>(null);

  const clear = useCallback(() => {
    setMessage(null);
    if (timer.current) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const show = useCallback((kind: FeedbackKind, text: string) => {
    setMessage({ kind, text });
    if (timer.current) window.clearTimeout(timer.current);
    // Waking messages stay longer because they stretch up to ~60s.
    const ttl = kind === 'waking' ? 65_000 : 6_000;
    timer.current = window.setTimeout(() => setMessage(null), ttl);
  }, []);

  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);

  return (
    <ControlFeedbackContext.Provider value={{ show, clear }}>
      {children}
      {message && (
        <div
          className="fixed left-3 right-3 z-[10001] pointer-events-none flex justify-center"
          style={{ bottom: 'calc(5rem + env(safe-area-inset-bottom) + 0.5rem)' }}
        >
          <div
            className={[
              'pointer-events-auto max-w-sm w-full text-sm rounded-xl px-4 py-3 border shadow-lg backdrop-blur',
              message.kind === 'success'
                ? 'bg-[#22c55e]/15 border-[#22c55e]/40 text-[#86efac]'
                : message.kind === 'waking'
                  ? 'bg-[#3b82f6]/15 border-[#3b82f6]/40 text-[#93c5fd]'
                  : 'bg-[#e31937]/15 border-[#e31937]/40 text-[#fca5a5]',
            ].join(' ')}
            role="status"
            aria-live="polite"
          >
            <div className="flex items-start gap-2">
              <span className="flex-1">{message.text}</span>
              <button
                type="button"
                onClick={clear}
                className="opacity-60 hover:opacity-100 leading-none"
                aria-label="dismiss"
              >×</button>
            </div>
          </div>
        </div>
      )}
    </ControlFeedbackContext.Provider>
  );
}
