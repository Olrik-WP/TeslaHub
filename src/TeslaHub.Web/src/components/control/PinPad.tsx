import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
  open: boolean;
  title: string;
  subtitle?: string;
  /** Total digit count expected (Tesla PINs are 4 numbers). */
  length?: number;
  /** Called when the user submits a complete pin. */
  onSubmit: (pin: string) => void;
  onClose: () => void;
  loading?: boolean;
  error?: string | null;
}

/**
 * 4-digit PIN pad shared by Valet Mode and Speed Limit. We deliberately
 * keep the modal full-screen on mobile and avoid the OS keyboard so users
 * can tap with one hand while holding the phone.
 */
export default function PinPad({ open, title, subtitle, length = 4, onSubmit, onClose, loading, error }: Props) {
  const { t } = useTranslation();
  const [pin, setPin] = useState('');

  useEffect(() => {
    if (!open) setPin('');
  }, [open]);

  if (!open) return null;

  const append = (d: string) => {
    if (pin.length >= length || loading) return;
    setPin((p) => p + d);
  };
  const back = () => setPin((p) => p.slice(0, -1));
  const clear = () => setPin('');
  const submit = () => {
    if (pin.length === length && !loading) onSubmit(pin);
  };

  const dots = Array.from({ length }, (_, i) => i < pin.length);

  return (
    <div className="fixed inset-0 z-[10000] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="w-full max-w-sm bg-[#141414] border border-[#2a2a2a] rounded-2xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="text-center mb-4">
          <h2 className="text-base font-semibold text-[#e0e0e0]">{title}</h2>
          {subtitle && <p className="text-xs text-[#9ca3af] mt-1">{subtitle}</p>}
        </header>

        <div className="flex items-center justify-center gap-3 my-4">
          {dots.map((filled, i) => (
            <span
              key={i}
              className={`w-3 h-3 rounded-full ${filled ? 'bg-[#e31937]' : 'bg-[#2a2a2a]'}`}
            />
          ))}
        </div>

        {error && (
          <p className="text-center text-[12px] text-[#e31937] mb-2">{error}</p>
        )}

        <div className="grid grid-cols-3 gap-2">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
            <PadButton key={n} onClick={() => append(String(n))} disabled={loading}>{n}</PadButton>
          ))}
          <PadButton onClick={clear} disabled={loading}>{t('control.pin.clear')}</PadButton>
          <PadButton onClick={() => append('0')} disabled={loading}>0</PadButton>
          <PadButton onClick={back} disabled={loading}>←</PadButton>
        </div>

        <div className="flex gap-2 mt-4">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="flex-1 py-2.5 rounded-lg border border-[#2a2a2a] text-[#9ca3af] text-sm"
          >
            {t('control.pin.cancel')}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={loading || pin.length !== length}
            className="flex-1 py-2.5 rounded-lg bg-[#e31937] text-white text-sm font-medium disabled:opacity-50"
          >
            {loading ? t('control.feedback.sending') : t('control.pin.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}

function PadButton({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="h-14 rounded-xl bg-[#1a1a1a] border border-[#2a2a2a] text-[#e0e0e0] text-lg active:bg-[#222] disabled:opacity-50"
      style={{ touchAction: 'manipulation' }}
    >
      {children}
    </button>
  );
}
