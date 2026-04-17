import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useMapStyle, useSetMapStyle, MAP_STYLES } from '../hooks/useMapStyle';

export default function MapStylePicker() {
  const { t } = useTranslation();
  const { styleKey } = useMapStyle();
  const setStyle = useSetMapStyle();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} className="absolute top-3 right-3 z-10">
      <button
        onClick={() => setOpen(!open)}
        className="w-9 h-9 bg-[#141414]/90 backdrop-blur border border-[#2a2a2a] rounded-lg flex items-center justify-center text-white hover:bg-[#1a1a1a] transition-colors"
        title={t('settings.mapStyle')}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
          <line x1="8" y1="2" x2="8" y2="18" />
          <line x1="16" y1="6" x2="16" y2="22" />
        </svg>
      </button>

      {open && (
        <div className="mt-1 bg-[#141414]/95 backdrop-blur border border-[#2a2a2a] rounded-lg overflow-hidden min-w-[180px] shadow-xl">
          {Object.entries(MAP_STYLES).map(([key, s]) => (
            <button
              key={key}
              onClick={() => { setStyle.mutate(key); setOpen(false); }}
              className={`w-full text-left px-3 py-2.5 text-sm transition-colors ${
                key === styleKey
                  ? 'bg-[#e31937]/20 text-[#e31937] font-medium'
                  : 'text-[#9ca3af] hover:bg-[#1a1a1a] hover:text-white'
              }`}
            >
              {t(s.labelKey)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
