import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { searchAddress, type SearchResult } from '../utils/geocoding';

interface Props {
  /** Optional bias: prefer results around this location (vehicle position
   *  is a sensible default). The bias only acts as a tiebreaker — the
   *  underlying search still ranks by global importance. */
  near?: { latitude: number; longitude: number } | null;
  /** Called when the user picks a result. Parent is expected to fly the
   *  map's camera to those coordinates. */
  onSelect: (latitude: number, longitude: number, displayName: string) => void;
}

/**
 * Floating address-search overlay for the map.
 *
 * Collapsed = a small magnifying-glass pill so the camera + map controls
 * stay unobstructed. Expanded = a full-width input with autocomplete.
 *
 * We sit at the top-center of the map, leaving the top-left corner free
 * for the MapLibre NavigationControl and the top-right area free for the
 * style picker.
 */
export default function MapSearchBar({ near, onSelect }: Props) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language || 'en';

  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (expanded) {
      // Defer focus by one frame so the slide-in animation has started
      // and the soft keyboard doesn't fight the layout transition.
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      setQuery('');
      setResults([]);
      abortRef.current?.abort();
    }
  }, [expanded]);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 3) {
      setResults([]);
      setSearching(false);
      abortRef.current?.abort();
      return;
    }
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setSearching(true);
    const handle = setTimeout(() => {
      searchAddress(trimmed, {
        language: lang,
        signal: ctrl.signal,
        near: near ?? undefined,
        limit: 10,
      })
        .then((r) => {
          if (!ctrl.signal.aborted) setResults(r);
        })
        .finally(() => {
          if (!ctrl.signal.aborted) setSearching(false);
        });
    }, 400);
    return () => {
      clearTimeout(handle);
      ctrl.abort();
    };
  }, [query, lang, near?.latitude, near?.longitude]);

  const pickResult = (r: SearchResult) => {
    onSelect(r.latitude, r.longitude, r.shortName || r.displayName);
    setExpanded(false);
  };

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        title={t('map.search.open')}
        aria-label={t('map.search.open')}
        // Top-center pill. We use translate-x rather than left:50% so it
        // stays out of the way of the NavigationControl (top-left) and
        // the style picker (top-right) without absolute pixel coupling.
        className="absolute top-2 left-1/2 -translate-x-1/2 z-20 bg-[#0a0a0a]/90 backdrop-blur-sm border border-[#2a2a2a] rounded-full shadow-lg flex items-center gap-2 pl-3 pr-4 py-2 text-xs text-[#e0e0e0] hover:bg-[#1a1a1a] active:bg-[#1a1a1a] transition-colors"
      >
        <span aria-hidden className="text-base leading-none">🔍</span>
        <span className="hidden sm:inline">{t('map.search.open')}</span>
      </button>
    );
  }

  return (
    <div
      className="absolute top-2 left-2 right-2 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 sm:w-[420px] z-20"
    >
      <div className="bg-[#0a0a0a]/95 backdrop-blur-sm border border-[#2a2a2a] rounded-xl shadow-2xl overflow-hidden">
        <div className="flex items-center gap-2 px-2.5 py-2">
          <span aria-hidden className="text-base leading-none text-[#9ca3af]">🔍</span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('map.search.placeholder')}
            className="flex-1 min-w-0 bg-transparent text-sm text-white placeholder-[#6b7280] focus:outline-none"
            autoComplete="off"
            inputMode="search"
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setExpanded(false);
              } else if (e.key === 'Enter' && results.length > 0) {
                e.preventDefault();
                pickResult(results[0]);
              }
            }}
          />
          {searching && (
            <span className="inline-block w-3 h-3 border-2 border-[#9ca3af] border-t-transparent rounded-full animate-spin" />
          )}
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="text-[#9ca3af] hover:text-white text-base px-2 -mr-1 leading-none"
            aria-label={t('map.search.close')}
          >
            ✕
          </button>
        </div>

        {query.trim().length >= 3 && (
          <ul className="max-h-[50vh] overflow-y-auto border-t border-[#1f1f1f]">
            {results.length === 0 && !searching && (
              <li className="px-3 py-2 text-xs text-[#6b7280] italic">
                {t('map.search.noResults')}
              </li>
            )}
            {results.map((r, idx) => (
              <li key={`${r.latitude}-${r.longitude}-${idx}`}>
                <button
                  type="button"
                  onClick={() => pickResult(r)}
                  className="w-full text-left px-3 py-2 hover:bg-[#1a1a1a] active:bg-[#1a1a1a] text-xs text-[#e0e0e0] border-b border-[#1a1a1a] last:border-b-0"
                >
                  <div className="font-medium truncate">{r.shortName || r.displayName}</div>
                  {r.shortName && r.shortName !== r.displayName && (
                    <div className="text-[10px] text-[#9ca3af] truncate">{r.displayName}</div>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}

        {query.trim().length > 0 && query.trim().length < 3 && (
          <div className="px-3 py-2 text-[10px] text-[#6b7280] italic border-t border-[#1f1f1f]">
            {t('map.search.hint')}
          </div>
        )}
      </div>
    </div>
  );
}
