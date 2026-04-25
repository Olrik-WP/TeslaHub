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
  /** Called when the user picks a search suggestion. Lets the parent fly
   *  the map to the picked location in addition to dropping a pin (the
   *  default `onPinChange` only updates the marker — without flying the
   *  camera the user could not see where their search landed). */
  onSearchSelect?: (latitude: number, longitude: number) => void;
  /** Optional reference to centre auto-suggestions and compute distance. */
  vehiclePosition?: { latitude: number; longitude: number } | null;
}

const inputClass =
  'w-full bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg px-3 py-2.5 text-sm text-[#e0e0e0] placeholder-[#6b7280] focus:outline-none focus:border-[#e31937]';

export default function SendToCarPanel({
  pin,
  onClose,
  onPinChange,
  onSearchSelect,
  vehiclePosition,
}: Props) {
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

  // Multi-select: default to ALL paired vehicles selected. Most users with
  // several cars want every car to receive the destination at once. The user
  // can still untick individual cars before sending.
  const [selectedVehicleIds, setSelectedVehicleIds] = useState<number[]>([]);
  useEffect(() => {
    setSelectedVehicleIds((current) => {
      const valid = current.filter((id) => eligibleVehicles.some((v) => v.id === id));
      if (valid.length > 0) return valid;
      return eligibleVehicles.map((v) => v.id);
    });
  }, [eligibleVehicles]);

  const toggleVehicle = (id: number) => {
    setSelectedVehicleIds((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    );
  };
  const selectAllVehicles = () =>
    setSelectedVehicleIds(eligibleVehicles.map((v) => v.id));
  const clearVehicleSelection = () => setSelectedVehicleIds([]);

  // Collapsed = thin pill that keeps the map visible. Auto-expand when there
  // is no pin yet (the user needs the search/help). Auto-collapse as soon as
  // a pin is set so the bottom of the map stays visible. The user can still
  // toggle manually.
  const [collapsed, setCollapsed] = useState(false);
  const userToggledRef = useRef(false);
  useEffect(() => {
    if (userToggledRef.current) return;
    setCollapsed(!!pin);
  }, [pin]);
  const toggleCollapsed = () => {
    userToggledRef.current = true;
    setCollapsed((c) => !c);
  };

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
        limit: 10,
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
  // We send sequentially-fired but unawaited-of-each-other requests via
  // Promise.allSettled so that one failing car does not block the others.
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const sendMutation = useMutation({
    mutationFn: async () => {
      if (!pin || selectedVehicleIds.length === 0) {
        throw new Error(t('sendToCar.feedback.missing'));
      }
      // Send a Google Maps URL containing the EXACT pin coordinates so
      // Tesla's server-side parser navigates to the dropped pin and not
      // to a nearby POI guessed from the (approximate) reverse-geocoded
      // address. The previous "Address\nLat,Lng" payload made Tesla fall
      // back to the address line, which is fuzzy by nature (Nominatim
      // snaps to the closest building/road), so the car would land
      // hundreds of meters off the actual map pin. The `https://maps.google.com/?q=lat,lng`
      // form is the same one the iOS Tesla share extension produces and
      // is reliably parsed by every Tesla firmware that supports
      // `command/share`. The optional `(label)` suffix is a Google Maps
      // convention Tesla honours to display a friendly destination name
      // instead of raw coordinates.
      const lat = pin.latitude.toFixed(6);
      const lng = pin.longitude.toFixed(6);
      const labelText = resolvedAddress?.trim();
      const value = labelText
        ? `https://maps.google.com/?q=${lat},${lng}(${encodeURIComponent(labelText).replace(/%20/g, '+')})`
        : `https://maps.google.com/?q=${lat},${lng}`;
      const results = await Promise.allSettled(
        selectedVehicleIds.map((id) =>
          api<{ sent: boolean; wokeUp?: boolean }>(`/tesla-share/${id}/destination`, {
            method: 'POST',
            body: JSON.stringify({ value, locale: lang }),
          }).then((r) => ({ id, wokeUp: !!r.wokeUp })),
        ),
      );
      const succeeded: { id: number; wokeUp: boolean }[] = [];
      const failed: { id: number; reason: string }[] = [];
      results.forEach((r, idx) => {
        const id = selectedVehicleIds[idx];
        if (r.status === 'fulfilled') succeeded.push(r.value);
        else failed.push({ id, reason: r.reason instanceof Error ? r.reason.message : String(r.reason) });
      });
      return { succeeded, failed };
    },
    onSuccess: ({ succeeded, failed }) => {
      const labelOf = (id: number) => {
        const car = eligibleVehicles.find((v) => v.id === id);
        return car?.displayName || car?.vin || `#${id}`;
      };
      const okNames = succeeded.map((s) => labelOf(s.id)).join(', ');
      const wokenNames = succeeded.filter((s) => s.wokeUp).map((s) => labelOf(s.id)).join(', ');
      const koNames = failed.map((f) => labelOf(f.id)).join(', ');
      if (failed.length === 0) {
        const text =
          succeeded.length > 1
            ? t('sendToCar.feedback.sentToMany', { vehicles: okNames, count: succeeded.length })
            : t('sendToCar.feedback.sentTo', { vehicle: okNames });
        setFeedback({
          ok: true,
          text: wokenNames
            ? `${text} ${t('sendToCar.feedback.wokeNote', { vehicles: wokenNames })}`
            : text,
        });
      } else if (succeeded.length === 0) {
        setFeedback({
          ok: false,
          text: t('sendToCar.feedback.allFailed', { vehicles: koNames }),
        });
      } else {
        setFeedback({
          ok: false,
          text: t('sendToCar.feedback.partialFailure', { ok: okNames, failed: koNames }),
        });
      }
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

  // After ~4s of "Sending…" with no response, show a hint that we are
  // probably waking the car up. The backend can take up to ~35s when a
  // wake_up is needed.
  const [showWakeHint, setShowWakeHint] = useState(false);
  useEffect(() => {
    if (!sendMutation.isPending) {
      setShowWakeHint(false);
      return;
    }
    const handle = setTimeout(() => setShowWakeHint(true), 4000);
    return () => clearTimeout(handle);
  }, [sendMutation.isPending]);

  const teslaConnected = !!availability?.connected;
  const hasPairedVehicle = eligibleVehicles.length > 0;
  const canSend =
    !!pin && hasPairedVehicle && selectedVehicleIds.length > 0 && !sendMutation.isPending;

  const useCurrentLocation = () => {
    if (!('geolocation' in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => onPinChange({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      () => {},
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  // ── Collapsed compact view ────────────────────────────────────────────
  // When the panel is collapsed, we keep just the bare minimum: pin label
  // + send button. Lets the user see the map underneath.
  if (collapsed && teslaConnected && hasPairedVehicle && pin) {
    const selectedCars = eligibleVehicles.filter((v) => selectedVehicleIds.includes(v.id));
    const carLabel =
      selectedCars.length === 0
        ? t('sendToCar.noTargetSelected')
        : selectedCars.length === eligibleVehicles.length && selectedCars.length > 1
          ? t('sendToCar.allCars', { count: selectedCars.length })
          : selectedCars.map((v) => v.displayName || v.vin).join(' + ');
    return (
      <div className="absolute inset-x-0 bottom-0 z-30 pointer-events-none">
        <div
          className="bg-[#0f0f0f] border-t border-[#2a2a2a] rounded-t-2xl shadow-2xl px-3 py-2 sm:px-4 sm:py-3 pointer-events-auto"
          style={{ paddingBottom: 'calc(0.5rem + env(safe-area-inset-bottom))' }}
        >
          <div className="flex justify-center mb-1 sm:hidden">
            <button
              type="button"
              onClick={toggleCollapsed}
              className="w-12 h-1.5 bg-[#3a3a3a] rounded-full hover:bg-[#4a4a4a]"
              aria-label={t('sendToCar.expand')}
            />
          </div>

          <div className="flex items-center gap-2">
            <span className="text-base shrink-0" aria-hidden>📍</span>
            <button
              type="button"
              onClick={toggleCollapsed}
              className="flex-1 min-w-0 text-left"
              aria-label={t('sendToCar.expand')}
            >
              <div className="text-[11px] text-[#9ca3af] uppercase tracking-wider leading-tight truncate">
                {carLabel}
              </div>
              <div className="text-xs text-[#e0e0e0] truncate leading-tight">
                {resolving
                  ? t('sendToCar.resolvingAddress')
                  : resolvedAddress || `${pin.latitude.toFixed(4)}, ${pin.longitude.toFixed(4)}`}
              </div>
            </button>
            <button
              onClick={() => sendMutation.mutate()}
              disabled={!canSend}
              className="bg-[#e31937] text-white px-3 py-2 rounded-lg text-xs font-semibold min-h-[40px] active:bg-[#c0152f] disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1 shrink-0"
            >
              <span aria-hidden>✈</span>
              <span>{sendMutation.isPending ? t('sendToCar.sending') : t('sendToCar.sendShort')}</span>
            </button>
            <button
              onClick={onClose}
              className="text-[#9ca3af] hover:text-white text-sm w-8 h-8 rounded shrink-0"
              aria-label={t('sendToCar.close')}
            >
              ✕
            </button>
          </div>

          {feedback && (
            <div
              className={`mt-2 text-[11px] px-2 py-1.5 rounded ${
                feedback.ok ? 'bg-[#1a3d1a] text-[#a7e9a7]' : 'bg-[#3d1a1a] text-[#f0a7a7]'
              }`}
            >
              {feedback.text}
            </div>
          )}
          {sendMutation.isPending && showWakeHint && (
            <div className="mt-1 text-[10px] text-[#9ca3af] italic flex items-center gap-1.5">
              <span className="inline-block w-2.5 h-2.5 border-2 border-[#9ca3af] border-t-transparent rounded-full animate-spin" />
              {t('sendToCar.feedback.wakingUp')}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-x-0 bottom-0 z-30 pointer-events-none">
      <div
        className="bg-[#0f0f0f] border-t border-[#2a2a2a] rounded-t-2xl shadow-2xl p-3 sm:p-4 max-h-[50dvh] sm:max-h-[60dvh] overflow-y-auto pointer-events-auto"
        style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}
      >
        {/* Drag handle — also collapses the panel on tap */}
        <div className="flex justify-center mb-2 sm:hidden">
          <button
            type="button"
            onClick={toggleCollapsed}
            className="w-12 h-1.5 bg-[#3a3a3a] rounded-full hover:bg-[#4a4a4a] disabled:opacity-50"
            disabled={!pin || !teslaConnected || !hasPairedVehicle}
            aria-label={t('sendToCar.collapse')}
          />
        </div>

        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-base">📍</span>
            <h2 className="text-sm font-semibold text-[#e0e0e0] truncate">
              {t('sendToCar.title')}
            </h2>
          </div>
          <div className="flex items-center gap-1">
            {pin && teslaConnected && hasPairedVehicle && (
              <button
                onClick={toggleCollapsed}
                className="hidden sm:inline-flex text-[#9ca3af] hover:text-white text-xs px-2 py-1 rounded min-h-[32px] items-center gap-1"
                aria-label={t('sendToCar.collapse')}
                title={t('sendToCar.collapse')}
              >
                ⌄
              </button>
            )}
            <button
              onClick={onClose}
              className="text-[#9ca3af] hover:text-white text-sm px-2 py-1 rounded min-h-[36px]"
              aria-label={t('sendToCar.close')}
            >
              ✕
            </button>
          </div>
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
              onClick={() => navigate('/settings?tab=tesla')}
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
              onClick={() => navigate('/settings?tab=tesla')}
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
                          // Prefer the parent's combined "pin + fly" hook
                          // when available so the camera follows the
                          // search; fall back to a plain pin update so
                          // the panel still works in isolation.
                          if (onSearchSelect) {
                            onSearchSelect(s.latitude, s.longitude);
                          } else {
                            onPinChange({ latitude: s.latitude, longitude: s.longitude });
                          }
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

            {/* Vehicle multi-picker (shown only when >1 paired car) ── */}
            {eligibleVehicles.length > 1 && (
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[10px] text-[#9ca3af] uppercase tracking-wider">
                    {t('sendToCar.targetVehicles', { count: selectedVehicleIds.length })}
                  </div>
                  <div className="flex items-center gap-2 text-[10px]">
                    <button
                      type="button"
                      onClick={selectAllVehicles}
                      disabled={selectedVehicleIds.length === eligibleVehicles.length}
                      className="text-[#9ca3af] hover:text-white disabled:text-[#4a4a4a] disabled:hover:text-[#4a4a4a]"
                    >
                      {t('sendToCar.selectAll')}
                    </button>
                    <span className="text-[#3a3a3a]">·</span>
                    <button
                      type="button"
                      onClick={clearVehicleSelection}
                      disabled={selectedVehicleIds.length === 0}
                      className="text-[#9ca3af] hover:text-white disabled:text-[#4a4a4a] disabled:hover:text-[#4a4a4a]"
                    >
                      {t('sendToCar.selectNone')}
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {eligibleVehicles.map((v) => {
                    const active = selectedVehicleIds.includes(v.id);
                    return (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => toggleVehicle(v.id)}
                        aria-pressed={active}
                        className={`text-left rounded-lg px-2.5 py-2 text-xs min-h-[44px] border transition-colors flex items-center gap-2 ${
                          active
                            ? 'bg-[#e31937] border-[#e31937] text-white'
                            : 'bg-[#0a0a0a] border-[#2a2a2a] text-[#e0e0e0] active:bg-[#1a1a1a]'
                        }`}
                      >
                        <span
                          className={`w-4 h-4 rounded border flex items-center justify-center text-[10px] shrink-0 ${
                            active ? 'bg-white text-[#e31937] border-white' : 'border-[#3a3a3a]'
                          }`}
                          aria-hidden
                        >
                          {active ? '✓' : ''}
                        </span>
                        <span className="min-w-0">
                          <span className="block font-medium truncate">{v.displayName || v.vin}</span>
                          <span className={`block text-[10px] truncate ${active ? 'text-white/80' : 'text-[#6b7280]'}`}>
                            {v.model || v.vin}
                          </span>
                        </span>
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

            {sendMutation.isPending && showWakeHint && (
              <div className="text-[11px] text-[#9ca3af] italic flex items-center gap-2 px-1">
                <span className="inline-block w-3 h-3 border-2 border-[#9ca3af] border-t-transparent rounded-full animate-spin" />
                {t('sendToCar.feedback.wakingUp')}
              </div>
            )}

            <button
              onClick={() => sendMutation.mutate()}
              disabled={!canSend}
              aria-label={
                selectedVehicleIds.length > 1
                  ? t('sendToCar.sendButtonMany', { count: selectedVehicleIds.length })
                  : t('sendToCar.sendButton')
              }
              className="w-full bg-[#e31937] text-white py-2.5 rounded-lg text-sm font-semibold min-h-[48px] active:bg-[#c0152f] disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              <span aria-hidden>✈</span>
              {sendMutation.isPending
                ? t('sendToCar.sending')
                : selectedVehicleIds.length > 1
                  ? t('sendToCar.sendButtonMany', { count: selectedVehicleIds.length })
                  : t('sendToCar.sendButton')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
