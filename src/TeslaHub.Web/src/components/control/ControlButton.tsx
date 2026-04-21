import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

export type ControlButtonState = 'neutral' | 'on' | 'off' | 'danger' | 'warning' | 'info';

interface Props {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  state?: ControlButtonState;
  disabled?: boolean;
  loading?: boolean;
  wakingHint?: boolean;
  fullWidth?: boolean;
  size?: 'sm' | 'md' | 'lg';
  title?: string;
}

const stateClasses: Record<ControlButtonState, string> = {
  // ON = green per user request: "change color based on status, more telling"
  on:      'bg-[#22c55e]/15 border-[#22c55e]/40 text-[#22c55e]',
  off:     'bg-[#1a1a1a] border-[#2a2a2a] text-[#9ca3af]',
  // Danger = unlocked / urgent: Tesla red
  danger:  'bg-[#e31937]/12 border-[#e31937]/40 text-[#e31937]',
  warning: 'bg-[#f59e0b]/15 border-[#f59e0b]/40 text-[#f59e0b]',
  info:    'bg-[#3b82f6]/15 border-[#3b82f6]/40 text-[#3b82f6]',
  neutral: 'bg-[#1a1a1a] border-[#2a2a2a] text-[#e0e0e0]',
};

const sizeClasses: Record<NonNullable<Props['size']>, string> = {
  sm: 'min-h-[44px] text-[11px] gap-1 px-2 py-1.5',
  md: 'min-h-[60px] text-xs gap-1 px-2 py-2',
  lg: 'min-h-[72px] text-sm gap-1.5 px-3 py-2.5',
};

/**
 * Standard control button shared across the Control page and the
 * Home quick actions chips. Carries:
 *   - dynamic colouring (state-based: on/off/danger/warning/info)
 *   - inline spinner while the mutation runs
 *   - "Waking your Tesla…" hint after 4s, mirroring SendToCarPanel UX.
 *   - disabled visuals + cursor-not-allowed when needed.
 */
export default function ControlButton({
  label,
  icon,
  onClick,
  state = 'neutral',
  disabled,
  loading,
  wakingHint,
  fullWidth,
  size = 'md',
  title,
}: Props) {
  const { t } = useTranslation();
  const cls = stateClasses[state];
  const sz = sizeClasses[size];
  const isInert = disabled || loading;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isInert}
      aria-busy={loading || undefined}
      title={title}
      className={[
        'flex flex-col items-center justify-center rounded-xl border transition-colors select-none',
        cls,
        sz,
        fullWidth ? 'w-full' : '',
        isInert ? 'opacity-60 cursor-not-allowed' : 'active:scale-[0.97]',
      ].join(' ')}
      style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent' }}
    >
      {loading ? (
        <Spinner />
      ) : (
        icon && <span className="leading-none">{icon}</span>
      )}
      <span className="leading-tight text-center break-words">
        {wakingHint && loading ? t('control.feedback.waking') : label}
      </span>
    </button>
  );
}

function Spinner() {
  return (
    <svg className="animate-spin" width="20" height="20" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity=".25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}
