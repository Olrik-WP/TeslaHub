import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { reverseGeocode, searchAddress, haversineMeters, type SearchResult } from '../utils/geocoding';

interface ShareTarget {
  id: number;
  vin: string;
  displayName?: string | null;
  model?: string | null;
  keyPaired: boolean;
}

interface ShareAvailability {
  configured: boolean;
  connected: boolean;
  vehicles: ShareTarget[];
}

interface Pin {
  latitude: number;
  longitude: number;
}

interface Props {
  pin: Pin | null;
  onClose: () => void;
  onPinChange: (pin: Pin) => void;
  /** Optional reference to centre auto-suggestions and compute distance. */
  vehiclePosition?: { latitude: number; longitude: number } | null;
}

const inputClass =
  'w-full bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg px-3 py-2.5 text-sm text-[#e0e0e0] placeholder-[#6b7280] focus:outline-none focus:border-[#e31937]';

export default function SendToCarPanel({ pin, onClose, onPinChange, vehiclePosition }: Props) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const lang = i18n.language || 'en';

  const { data: availability, isLoading: availabilityLoading } = useQuery<ShareAvailability>({
    queryKey: ['teslaShareTargets'],
    queryFn: () => api<ShareAvailability>('/tesla-share/targets'),
    staleTime: 60_000,
  });

  const eligibleVehicles = useMemo(
    () => availability?.vehicles.filter((v) => v.keyPaired) ?? [],
    [availability],
  );

  const [selectedVehicleId, setSelectedVehicleId] = useState<number | null>(null);
  useEffect(() => {
    if (selectedVehicleId == null && eligibleVehicles.length > 0) {
      setSelectedVehicleId(eligibleVehicles[0].id);
    } else if (selectedVehicleId != null && !eligibleVehicles.some((v) => v.id === selectedVehicleId)) {
      setSelectedVehicleId(eligibleVehicles[0]?.id ?? null);
    }
  }, [eligibleVehicles, selectedVehicleId]);

  const [resolvedAddress, setResolvedAddress] = useState<string>('');
  const [resolving, setResolving] = useState(false);
  const reverseAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!pin) {
      setResolvedAddress('');
      return;
    }
    reverseAbortRef.current?.abort();
    const ctrl = new AbortController();
    reverseAbortRef.current = ctrl;
    setResolving(true);
    reverseGeocode(pin.latitude, pin.longitude, { language: lang, signal: ctrl.signal })
      .then((short) => {
        if (!ctrl.signal.aborted) setResolvedAddress(short);
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setResolving(false);
      });
    return () => ctrl.abort();
  }, [pin?.latitude, pin?.longitude, lang]);

  // ── Address autocomplete ─────────────────────────────────────────────
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const searchAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 3) {
      setSuggestions([]);
      setSearching(false);
      searchAbortRef.current?.abort();
      return;
    }
    searchAbortRef.current?.abort();
    const ctrl = new AbortController();
    searchAbortRef.current = ctrl;
    setSearching(true);
    const handle = setTimeout(() => {
      searchAddress(trimmed, {
        language: lang,
        signal: ctrl.signal,
        near: vehiclePosition ?? undefined,
        limit: 6,
      })
        .then((results) => {
          if (!ctrl.signal.aborted) setSuggestions(results);
        })
        .finally(() => {
          if (!ctrl.signal.aborted) setSearching(false);
        });
    }, 450);
    return () => {
      clearTimeout(handle);
      ctrl.abort();
    };
  }, [query, lang, vehiclePosition?.latitude, vehiclePosition?.longitude]);

  const distanceLabel = useMemo(() => {
    if (!pin || !vehiclePosition) return null;
    const meters = haversineMeters(vehiclePosition, pin);
    if (meters < 1000) return `${Math.round(meters)} m`;
    return `${(meters / 1000).toFixed(meters < 10_000 ? 1 : 0)} km`;
  }, [pin, vehiclePosition]);

  // ── Send mutation ─────────────────────────────────────────────────────
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const sendMutation = useMutation({
    mutationFn: () => {
      if (!pin || selectedVehicleId == null) {
        return Promise.reject(new Error(t('sendToCar.feedback.missing')));
      }
      const value = resolvedAddress
        ? `${resolvedAddress}\n${pin.latitude.toFixed(6)},${pin.longitude.toFixed(6)}`
        : `${pin.latitude.toFixed(6)},${pin.longitude.toFixed(6)}`;
      return api<{ sent: boolean }>(`/tesla-share/${selectedVehicleId}/destination`, {
        method: 'POST',
        body: JSON.stringify({ value, locale: lang }),
      });
    },
    onSuccess: () => {
      const car = eligibleVehicles.find((v) => v.id === selectedVehicleId);
      const label = car?.displayName || car?.vin || '';
      setFeedback({
        ok: true,
        text: label
          ? t('sendToCar.feedback.sentTo', { vehicle: label })
          : t('sendToCar.feedback.sent'),
      });
    },
    onError: (err: Error) => {
      setFeedback({ ok: false, text: err.message });
    },
  });

  // Clear feedback when the user changes inputs after a result
  useEffect(() => {
    if (!feedback) return;
    const handle = setTimeout(() => setFeedback(null), 6000);
    return () => clearTimeout(handle);
  }, [feedback]);

  const teslaConnected = !!availability?.connected;
  const hasPairedVehicle = eligibleVehicles.length > 0;
  const canSend = !!pin && hasPairedVehicle && selectedVehicleId != null && !sendMutation.isPending;

  const useCurrentLocation = () => {
    if (!('geolocation' in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => onPinChange({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      () => {},
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  return (
    <div className="absolute inset-x-0 bottom-0 z-30 pointer-events-none">
      <div className="bg-[#0f0f0f] border-t border-[#2a2a2a] rounded-t-2xl shadow-2xl p-3 sm:p-4 max-h-[60dvh] overflow-y-auto pointer-events-auto">
        {/* Drag handle (decorative on mobile) */}
        <div className="flex justify-center mb-2 sm:hidden">
          <div className="w-10 h-1 bg-[#2a2a2a] rounded-full" />
        </div>

        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-base">📍</span>
            <h2 className="text-sm font-semibold text-[#e0e0e0] truncate">
              {t('sendToCar.title')}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-[#9ca3af] hover:text-white text-sm px-2 py-1 rounded min-h-[36px]"
            aria-label={t('sendToCar.close')}
          >
            ✕
          </button>
        </div>

        {/* Fleet API not configured / not connected ─────────────────── */}
        {availabilityLoading ? (
          <div className="text-xs text-[#9ca3af] py-2">{t('sendToCar.loading')}</div>
        ) : !teslaConnected ? (
          <div className="bg-[#3a2a1a] border border-[#5a3a1a] rounded-lg p-3 space-y-2">
            <div className="text-xs text-[#e0c47e] font-medium">
              {availability?.configured
                ? t('sendToCar.guard.notConnected.title')
                : t('sendToCar.guard.notConfigured.title')}
            </div>
            <p className="text-xs text-[#c8b07e]">
              {availability?.configured
                ? t('sendToCar.guard.notConnected.body')
                : t('sendToCar.guard.notConfigured.body')}
            </p>
            <button
              onClick={() => navigate('/settings')}
              className="bg-[#e31937] text-white px-3 py-1.5 rounded-lg text-xs font-medium active:bg-[#c0152f] min-h-[36px]"
            >
              {t('sendToCar.guard.openSettings')}
            </button>
          </div>
        ) : !hasPairedVehicle ? (
          <div className="bg-[#3a2a1a] border border-[#5a3a1a] rounded-lg p-3 space-y-2">
            <div className="text-xs text-[#e0c47e] font-medium">
              {t('sendToCar.guard.noPaired.title')}
            </div>
            <p className="text-xs text-[#c8b07e]">{t('sendToCar.guard.noPaired.body')}</p>
            <button
              onClick={() => navigate('/settings')}
              className="bg-[#e31937] text-white px-3 py-1.5 rounded-lg text-xs font-medium active:bg-[#c0152f] min-h-[36px]"
            >
              {t('sendToCar.guard.openSettings')}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Address search */}
            <div className="relative">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('sendToCar.searchPlaceholder')}
                className={inputClass}
                autoComplete="off"
                inputMode="search"
              />
              {searching && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2 text-[#6b7280] text-xs">
                  …
                </div>
              )}
              {suggestions.length > 0 && (
                <ul className="absolute z-10 left-0 right-0 mt-1 bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg max-h-60 overflow-y-auto shadow-xl">
                  {suggestions.map((s, idx) => (
                    <li key={`${s.latitude}-${s.longitude}-${idx}`}>
                      <button
                        type="button"
                        className="w-full text-left px-3 py-2 hover:bg-[#1a1a1a] active:bg-[#1a1a1a] text-xs text-[#e0e0e0] border-b border-[#1a1a1a] last:border-b-0"
                        onClick={() => {
                          onPinChange({ latitude: s.latitude, longitude: s.longitude });
                          setQuery('');
                          setSuggestions([]);
                        }}
                      >
                        <div className="font-medium truncate">{s.shortName || s.displayName}</div>
                        {s.shortName && s.shortName !== s.displayName && (
                          <div className="text-[10px] text-[#9ca3af] truncate">{s.displayName}</div>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="flex gap-2 text-[11px]">
              <button
                onClick={useCurrentLocation}
                className="bg-[#1a1a1a] text-[#9ca3af] px-2.5 py-1 rounded-md min-h-[32px] active:bg-[#2a2a2a]"
                type="button"
              >
                📡 {t('sendToCar.useMyLocation')}
              </button>
              <span className="text-[#6b7280] self-center">{t('sendToCar.orTapMap')}</span>
            </div>

            {/* Pin info ─────────────────────────────────────────────── */}
            <div className="bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg p-2.5 space-y-1">
              <div className="text-[10px] text-[#9ca3af] uppercase tracking-wider">
                {t('sendToCar.destination')}
              </div>
              {pin ? (
                <>
                  <div className="text-sm text-[#e0e0e0] break-words">
                    {resolving ? (
                      <span className="text-[#6b7280] italic">{t('sendToCar.resolvingAddress')}</span>
                    ) : resolvedAddress ? (
                      resolvedAddress
                    ) : (
                      <span className="text-[#6b7280] italic">
                        {t('sendToCar.noAddressFound')}
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-[#6b7280] tabular-nums">
                    {pin.latitude.toFixed(5)}, {pin.longitude.toFixed(5)}
                    {distanceLabel && ` · ${t('sendToCar.distanceFromVehicle', { distance: distanceLabel })}`}
                  </div>
                </>
              ) : (
                <div className="text-xs text-[#6b7280]">{t('sendToCar.noPinYet')}</div>
              )}
            </div>

            {/* Vehicle picker (shown only when >1 paired car) ─────── */}
            {eligibleVehicles.length > 1 && (
              <div className="space-y-1">
                <div className="text-[10px] text-[#9ca3af] uppercase tracking-wider">
                  {t('sendToCar.targetVehicle')}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {eligibleVehicles.map((v) => {
                    const active = v.id === selectedVehicleId;
                    return (
                      <button
                        key={v.id}
                        onClick={() => setSelectedVehicleId(v.id)}
                        className={`text-left rounded-lg px-2.5 py-2 text-xs min-h-[44px] border transition-colors ${
                          active
                            ? 'bg-[#e31937] border-[#e31937] text-white'
                            : 'bg-[#0a0a0a] border-[#2a2a2a] text-[#e0e0e0] active:bg-[#1a1a1a]'
                        }`}
                      >
                        <div className="font-medium truncate">{v.displayName || v.vin}</div>
                        <div className={`text-[10px] truncate ${active ? 'text-white/80' : 'text-[#6b7280]'}`}>
                          {v.model || v.vin}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {feedback && (
              <div
                className={`text-xs px-3 py-2 rounded ${
                  feedback.ok ? 'bg-[#1a3d1a] text-[#a7e9a7]' : 'bg-[#3d1a1a] text-[#f0a7a7]'
                }`}
              >
                {feedback.text}
                {feedback.ok && (
                  <div className="text-[10px] text-[#a7e9a7]/80 mt-1">
                    {t('sendToCar.feedback.confirmHint')}
                  </div>
                )}
              </div>
            )}

            <button
              onClick={() => sendMutation.mutate()}
              disabled={!canSend}
              className="w-full bg-[#e31937] text-white py-2.5 rounded-lg text-sm font-semibold min-h-[48px] active:bg-[#c0152f] disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              <span>✈</span>
              {sendMutation.isPending ? t('sendToCar.sending') : t('sendToCar.sendButton')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
