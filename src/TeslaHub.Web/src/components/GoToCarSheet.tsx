import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { VehicleStatus } from '../api/queries';
import { useUnits } from '../hooks/useUnits';
import { utcDate } from '../utils/date';
import { reverseGeocode } from '../utils/geocoding';

interface Props {
  open: boolean;
  onClose: () => void;
  vehicle: VehicleStatus;
  /** Optional fresher live coordinates from MQTT. */
  liveLatitude?: number | null;
  liveLongitude?: number | null;
  /** Optional pre-resolved address (we reuse what Home already fetched). */
  address?: string | null;
}

type Platform = 'ios' | 'android' | 'desktop';

function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'desktop';
  const ua = navigator.userAgent || '';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return 'desktop';
}

function haversineMeters(a: [number, number], b: [number, number]): number {
  const toRad = (n: number) => (n * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const lat1 = toRad(a[0]);
  const lat2 = toRad(b[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function bearingDeg(from: [number, number], to: [number, number]): number {
  const toRad = (n: number) => (n * Math.PI) / 180;
  const toDeg = (n: number) => (n * 180) / Math.PI;
  const lat1 = toRad(from[0]);
  const lat2 = toRad(to[0]);
  const dLng = toRad(to[1] - from[1]);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function compassPoint(deg: number, t: (k: string) => string): string {
  const dirs = [
    'compass.n', 'compass.ne', 'compass.e', 'compass.se',
    'compass.s', 'compass.sw', 'compass.w', 'compass.nw',
  ];
  const idx = Math.round(deg / 45) % 8;
  return t(dirs[idx]);
}

export default function GoToCarSheet({
  open,
  onClose,
  vehicle,
  liveLatitude,
  liveLongitude,
  address,
}: Props) {
  const { t, i18n } = useTranslation();
  const u = useUnits();
  const platform = useMemo(detectPlatform, []);

  const [userPos, setUserPos] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [geoRequesting, setGeoRequesting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [resolvedAddress, setResolvedAddress] = useState<string | null>(address ?? null);

  // Source of truth for car coordinates: prefer freshest MQTT, fallback to DB.
  const carLat = liveLatitude ?? vehicle.latitude;
  const carLng = liveLongitude ?? vehicle.longitude;

  // Reverse-geocode if we don't already have an address from the parent.
  const geocodeAbortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!open) return;
    if (address) {
      setResolvedAddress(address);
      return;
    }
    if (carLat == null || carLng == null) return;
    geocodeAbortRef.current?.abort();
    const ctrl = new AbortController();
    geocodeAbortRef.current = ctrl;
    reverseGeocode(carLat, carLng, { language: i18n.language, signal: ctrl.signal })
      .then((short) => {
        if (short) setResolvedAddress(short);
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [open, address, carLat, carLng, i18n.language]);

  // Lock body scroll when the sheet is open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Close with Escape.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const requestGeo = () => {
    if (!('geolocation' in navigator)) {
      setGeoError(t('goToCar.geoUnavailable'));
      return;
    }
    setGeoRequesting(true);
    setGeoError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserPos({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
        setGeoRequesting(false);
      },
      (err) => {
        setGeoRequesting(false);
        if (err.code === err.PERMISSION_DENIED) setGeoError(t('goToCar.geoDenied'));
        else if (err.code === err.POSITION_UNAVAILABLE) setGeoError(t('goToCar.geoUnavailable'));
        else if (err.code === err.TIMEOUT) setGeoError(t('goToCar.geoTimeout'));
        else setGeoError(t('goToCar.geoError'));
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 },
    );
  };

  // Auto-request once on open (some browsers gate this to a click; we ignore
  // silently if the prompt is dismissed and the user can retry via a button).
  useEffect(() => {
    if (!open) return;
    if (userPos || geoRequesting || geoError) return;
    requestGeo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open || carLat == null || carLng == null) return null;

  const distanceM =
    userPos != null ? haversineMeters([userPos.lat, userPos.lng], [carLat, carLng]) : null;
  const bearing =
    userPos != null ? bearingDeg([userPos.lat, userPos.lng], [carLat, carLng]) : null;

  const distanceLabel = (() => {
    if (distanceM == null) return null;
    if (u.distanceUnit === 'mi') {
      const miles = distanceM / 1609.344;
      if (miles < 0.1) {
        const feet = distanceM * 3.28084;
        return `${Math.round(feet)} ft`;
      }
      return `${miles.toFixed(miles < 10 ? 2 : 1)} mi`;
    }
    if (distanceM < 1000) return `${Math.round(distanceM)} m`;
    return `${(distanceM / 1000).toFixed(distanceM < 10000 ? 2 : 1)} km`;
  })();

  // Status line: "Parked since 2h13" / "Charging" / etc.
  const stateLabel = (() => {
    const s = (vehicle.state ?? '').toLowerCase();
    const since = vehicle.positionDate ? utcDate(vehicle.positionDate) : null;
    let elapsed: string | null = null;
    if (since) {
      const mins = Math.max(0, Math.floor((Date.now() - since.getTime()) / 60_000));
      if (mins < 60) elapsed = `${mins} min`;
      else if (mins < 24 * 60) elapsed = `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, '0')}`;
      else elapsed = `${Math.floor(mins / (24 * 60))}j`;
    }
    if (s === 'charging') return t('goToCar.statusCharging');
    if (s === 'asleep') return t('goToCar.statusAsleep');
    if (s === 'offline') return t('goToCar.statusOffline');
    if (s === 'parked' || s === 'online' || s === '') {
      return elapsed
        ? t('goToCar.statusParkedSince', { duration: elapsed })
        : t('goToCar.statusParked');
    }
    return vehicle.state ?? '';
  })();

  // Map app deeplinks. Walking mode whenever supported.
  const dest = `${carLat},${carLng}`;
  const label = encodeURIComponent(t('goToCar.markerLabel'));
  const openExternal = (url: string) => {
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const openApplePlans = () => openExternal(`https://maps.apple.com/?daddr=${dest}&dirflg=w`);
  const openGoogleMaps = () =>
    openExternal(`https://www.google.com/maps/dir/?api=1&destination=${dest}&travelmode=walking`);
  const openSystemPicker = () => openExternal(`geo:${dest}?q=${dest}(${label})`);
  const openWaze = () => openExternal(`https://waze.com/ul?ll=${dest}&navigate=yes`);

  const copyCoords = async () => {
    try {
      await navigator.clipboard.writeText(`${carLat}, ${carLng}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = `${carLat}, ${carLng}`;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* ignore */ }
      document.body.removeChild(ta);
    }
  };

  // Body / charging chips.
  const chips: { key: string; label: string; color: string }[] = [];
  if (vehicle.batteryLevel != null) {
    chips.push({
      key: 'soc',
      label: `${vehicle.batteryLevel}%`,
      color: vehicle.batteryLevel >= 50 ? '#22c55e' : vehicle.batteryLevel >= 20 ? '#eab308' : '#ef4444',
    });
  }
  if (vehicle.isLocked === true) {
    chips.push({ key: 'locked', label: t('goToCar.locked'), color: '#22c55e' });
  } else if (vehicle.isLocked === false) {
    chips.push({ key: 'unlocked', label: t('goToCar.unlocked'), color: '#ef4444' });
  }
  if (vehicle.sentryMode === true) {
    chips.push({ key: 'sentry', label: t('goToCar.sentry'), color: '#3b82f6' });
  }
  if (vehicle.pluggedIn === true || (vehicle.state ?? '').toLowerCase() === 'charging') {
    chips.push({ key: 'plugged', label: t('goToCar.pluggedIn'), color: '#3b82f6' });
  }

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center"
      role="dialog"
      aria-modal="true"
    >
      <div
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
        aria-hidden
      />
      <div
        className="relative w-full sm:max-w-md bg-[#141414] border-t sm:border border-[#2a2a2a] sm:rounded-2xl rounded-t-2xl shadow-2xl text-white animate-[teslahub-sheet-up_240ms_ease-out]"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <style>{`
          @keyframes teslahub-sheet-up {
            from { transform: translateY(100%); opacity: 0.6; }
            to   { transform: translateY(0);   opacity: 1;   }
          }
        `}</style>

        <div className="flex justify-center pt-2 pb-1 sm:hidden">
          <span className="block w-10 h-1 rounded-full bg-[#3a3a3a]" />
        </div>

        <div className="flex items-center justify-between px-4 pt-2 pb-3 border-b border-[#2a2a2a]">
          <div className="flex items-center gap-2">
            <span className="text-lg" aria-hidden>🚗</span>
            <h2 className="text-base font-semibold">{t('goToCar.title')}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[#9ca3af] hover:text-white p-1"
            aria-label={t('goToCar.close')}
          >
            ✕
          </button>
        </div>

        <div className="px-4 py-3 space-y-3 max-h-[70vh] overflow-y-auto">
          <div>
            <div className="text-xs text-[#9ca3af] uppercase tracking-wider">{t('goToCar.location')}</div>
            <div className="text-sm font-medium text-white mt-0.5">
              {resolvedAddress ?? t('goToCar.resolvingAddress')}
            </div>
            <div className="text-[11px] text-[#6b7280] tabular-nums mt-0.5">
              {carLat.toFixed(5)}, {carLng.toFixed(5)}
              {vehicle.geofence ? ` · ${vehicle.geofence}` : ''}
            </div>
            <div className="text-[11px] text-[#9ca3af] mt-1">{stateLabel}</div>
          </div>

          {chips.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {chips.map((c) => (
                <span
                  key={c.key}
                  className="text-[11px] font-medium px-2 py-0.5 rounded-full border"
                  style={{ color: c.color, borderColor: `${c.color}55`, background: `${c.color}10` }}
                >
                  {c.label}
                </span>
              ))}
            </div>
          )}

          <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-3">
            {userPos && distanceLabel != null && bearing != null ? (
              <div className="flex items-center gap-3">
                <div
                  className="flex-shrink-0 w-12 h-12 rounded-full bg-[#0a0a0a] border border-[#2a2a2a] flex items-center justify-center text-[#22c55e]"
                  aria-hidden
                >
                  <span style={{ display: 'inline-block', transform: `rotate(${bearing}deg)`, fontSize: 22, lineHeight: '22px' }}>↑</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-[#9ca3af] uppercase tracking-wider">{t('goToCar.distance')}</div>
                  <div className="text-lg font-bold tabular-nums text-white">{distanceLabel}</div>
                  <div className="text-[11px] text-[#9ca3af]">
                    {compassPoint(bearing, t)} · ±{Math.round(userPos.accuracy)} m
                  </div>
                </div>
              </div>
            ) : geoRequesting ? (
              <div className="text-sm text-[#9ca3af] text-center py-2">{t('goToCar.geoRequesting')}</div>
            ) : geoError ? (
              <div className="space-y-2">
                <div className="text-xs text-[#ef4444]">{geoError}</div>
                <button
                  type="button"
                  onClick={requestGeo}
                  className="w-full text-sm font-medium px-3 py-2 rounded-lg bg-[#0a0a0a] border border-[#2a2a2a] text-white hover:bg-[#1f1f1f]"
                >
                  {t('goToCar.geoRetry')}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={requestGeo}
                className="w-full text-sm font-medium px-3 py-2 rounded-lg bg-[#0a0a0a] border border-[#2a2a2a] text-white hover:bg-[#1f1f1f]"
              >
                {t('goToCar.useMyLocation')}
              </button>
            )}
          </div>

          <div className="space-y-2">
            <div className="text-xs text-[#9ca3af] uppercase tracking-wider">{t('goToCar.openIn')}</div>

            {platform === 'ios' && (
              <>
                <button
                  type="button"
                  onClick={openApplePlans}
                  className="w-full text-sm font-semibold px-3 py-3 rounded-xl bg-[#e31937] text-white hover:bg-[#c81630] active:bg-[#b1132a]"
                >
                  {t('goToCar.applePlans')}
                </button>
                <button
                  type="button"
                  onClick={openGoogleMaps}
                  className="w-full text-sm font-medium px-3 py-3 rounded-xl bg-[#1a1a1a] border border-[#2a2a2a] text-white hover:bg-[#1f1f1f]"
                >
                  {t('goToCar.googleMaps')}
                </button>
              </>
            )}

            {platform === 'android' && (
              <>
                <button
                  type="button"
                  onClick={openSystemPicker}
                  className="w-full text-sm font-semibold px-3 py-3 rounded-xl bg-[#e31937] text-white hover:bg-[#c81630] active:bg-[#b1132a]"
                >
                  {t('goToCar.systemPicker')}
                </button>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={openGoogleMaps}
                    className="text-sm font-medium px-3 py-3 rounded-xl bg-[#1a1a1a] border border-[#2a2a2a] text-white hover:bg-[#1f1f1f]"
                  >
                    {t('goToCar.googleMaps')}
                  </button>
                  <button
                    type="button"
                    onClick={openWaze}
                    className="text-sm font-medium px-3 py-3 rounded-xl bg-[#1a1a1a] border border-[#2a2a2a] text-white hover:bg-[#1f1f1f]"
                  >
                    {t('goToCar.waze')}
                  </button>
                </div>
              </>
            )}

            {platform === 'desktop' && (
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={openGoogleMaps}
                  className="text-sm font-semibold px-3 py-3 rounded-xl bg-[#e31937] text-white hover:bg-[#c81630]"
                >
                  {t('goToCar.googleMaps')}
                </button>
                <button
                  type="button"
                  onClick={openApplePlans}
                  className="text-sm font-medium px-3 py-3 rounded-xl bg-[#1a1a1a] border border-[#2a2a2a] text-white hover:bg-[#1f1f1f]"
                >
                  {t('goToCar.applePlans')}
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={copyCoords}
              className="w-full text-xs font-medium px-3 py-2 rounded-lg bg-transparent text-[#9ca3af] hover:text-white"
            >
              {copied ? t('goToCar.copied') : t('goToCar.copyCoords')}
            </button>
          </div>

          <p className="text-[10px] text-[#6b7280] leading-relaxed text-center pt-1">
            {t('goToCar.disclaimer')}
          </p>
        </div>
      </div>
    </div>
  );
}
