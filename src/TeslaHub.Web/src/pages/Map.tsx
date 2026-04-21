import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import {
  getRecentPositions,
  getPositionsInRange,
  getChargingSessions,
  getDrivePositions,
  getSettings,
  type GlobalSettings,
} from '../api/queries';
import { api } from '../api/client';
import MapLibreMap, { type LivePosition } from '../components/MapLibreMap';
import SendToCarPanel from '../components/SendToCarPanel';
import { useLiveStream } from '../hooks/useLiveStream';
import { useVehicleStatus } from '../hooks/useVehicle';
import { STALE_TIME } from '../constants/theme';

interface Props {
  carId: number | undefined;
}

type RangeKey = '24h' | '48h' | '7d' | '30d' | 'custom';

const RANGE_OPTIONS: { key: RangeKey; labelKey: string; hours?: number }[] = [
  { key: '24h', labelKey: '24h', hours: 24 },
  { key: '48h', labelKey: '48h', hours: 48 },
  { key: '7d', labelKey: 'map.7days', hours: 168 },
  { key: '30d', labelKey: 'map.30days', hours: 720 },
  { key: 'custom', labelKey: 'map.custom' },
];

// Append a live position to the trace only if it moved more than ~5m,
// to avoid filling memory with GPS jitter when the car is parked.
const MIN_TRACE_DISTANCE_M = 5;
const MAX_LIVE_TRACE_POINTS = 2000;

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

function fmtDate(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function fmtTime(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function MapPage({ carId }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const { t } = useTranslation();
  const driveIdParam = searchParams.get('driveId');
  const driveId = driveIdParam ? parseInt(driveIdParam, 10) : null;

  // Historical route layer can be heavy on long ranges (thousands of points)
  // — keep it off by default and persist the user's choice. Always force-on
  // when looking at a single drive: that *is* the page's whole purpose.
  const SHOW_ROUTE_STORAGE_KEY = 'teslahub_map_show_route';
  const [showRoute, setShowRoute] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem(SHOW_ROUTE_STORAGE_KEY) === '1';
  });
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(SHOW_ROUTE_STORAGE_KEY, showRoute ? '1' : '0');
    }
  }, [showRoute]);
  const routeVisible = driveId != null || showRoute;

  const [rangeKey, setRangeKey] = useState<RangeKey>('48h');
  const [customFromDate, setCustomFromDate] = useState(() =>
    fmtDate(new Date(Date.now() - 48 * 3600_000)),
  );
  const [customFromTime, setCustomFromTime] = useState(() =>
    fmtTime(new Date(Date.now() - 48 * 3600_000)),
  );
  const [customToDate, setCustomToDate] = useState(() => fmtDate(new Date()));
  const [customToTime, setCustomToTime] = useState(() => fmtTime(new Date()));

  const customFrom = `${customFromDate}T${customFromTime}`;
  const customTo = `${customToDate}T${customToTime}`;

  const selectedRange = RANGE_OPTIONS.find((r) => r.key === rangeKey)!;

  // Live tracking is only relevant when no specific drive is being inspected.
  const liveModeAvailable = driveId == null;
  const [followLive, setFollowLive] = useState(true);

  // Stop the live stream / drop SSE when not on the dynamic map view.
  const { data: live, connected } = useLiveStream(carId, liveModeAvailable);
  // Polled status gives us a reliable "MQTT is wired up" flag (mqttConnected) even
  // when no SSE event has arrived yet.
  const { data: vehicle } = useVehicleStatus(liveModeAvailable ? carId : undefined);

  // True only when MQTT actually pushes us coordinates: this is the safety net
  // for users who don't run Mosquitto.
  const liveActive =
    liveModeAvailable &&
    connected &&
    live?.latitude != null &&
    live?.longitude != null;

  // Whether to show the toggle UI at all (we hint at MQTT support if the backend reports it).
  const liveSupported =
    liveModeAvailable && (liveActive || vehicle?.mqttConnected === true);

  // Buffer of live positions accumulated while the user stays on the page.
  const [liveTrace, setLiveTrace] = useState<[number, number][]>([]);
  const lastLiveRef = useRef<[number, number] | null>(null);

  useEffect(() => {
    if (!liveActive || live?.latitude == null || live?.longitude == null) return;
    const next: [number, number] = [live.latitude, live.longitude];
    const prev = lastLiveRef.current;
    if (prev && haversineMeters(prev, next) < MIN_TRACE_DISTANCE_M) return;
    lastLiveRef.current = next;
    setLiveTrace((cur) => {
      const merged = [...cur, next];
      return merged.length > MAX_LIVE_TRACE_POINTS
        ? merged.slice(merged.length - MAX_LIVE_TRACE_POINTS)
        : merged;
    });
  }, [liveActive, live?.latitude, live?.longitude]);

  // Reset the live trace whenever live mode is toggled off or carId changes.
  useEffect(() => {
    if (!liveModeAvailable) {
      setLiveTrace([]);
      lastLiveRef.current = null;
    }
  }, [liveModeAvailable, carId]);

  // Single drive mode
  const { data: drivePositions } = useQuery({
    queryKey: ['drivePositions', driveId],
    queryFn: () => getDrivePositions(driveId!),
    enabled: driveId != null,
    placeholderData: keepPreviousData,
  });

  // Range mode
  const { data: rangePositions } = useQuery({
    queryKey:
      rangeKey === 'custom'
        ? ['mapPositions', carId, 'custom', customFrom, customTo]
        : ['mapPositions', carId, rangeKey],
    queryFn: () => {
      if (!carId) return Promise.resolve([]);
      if (rangeKey === 'custom') {
        return getPositionsInRange(
          carId,
          new Date(customFrom).toISOString(),
          new Date(customTo).toISOString(),
        );
      }
      return getRecentPositions(carId, selectedRange.hours!);
    },
    // Skip the (potentially heavy) positions fetch when the user has
    // hidden the route. Single-drive mode goes through `drivePositions`
    // above so this only gates the range view.
    enabled: !!carId && driveId == null && showRoute,
    staleTime: STALE_TIME.live,
    placeholderData: keepPreviousData,
  });

  const { data: charges } = useQuery({
    queryKey: ['chargingForMap', carId],
    queryFn: () => getChargingSessions(carId!, 20),
    enabled: !!carId && driveId == null,
    placeholderData: keepPreviousData,
  });

  // Public chargers layer (Open Charge Map). Off by default. The toggle is
  // also exposed as a quick button in the toolbar (next to Live / Send-to-car)
  // so the user can flip it without leaving the map.
  const queryClient = useQueryClient();
  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: getSettings,
    staleTime: 5 * 60_000,
  });
  const showPublicChargers = !!settings?.chargersEnabled;
  const toggleChargers = useMutation({
    mutationFn: (enabled: boolean) => {
      if (!settings) return Promise.resolve(null);
      const updated: GlobalSettings = { ...settings, chargersEnabled: enabled };
      return api<GlobalSettings>('/costs/settings', {
        method: 'PUT',
        body: JSON.stringify(updated),
      });
    },
    onMutate: (enabled) => {
      // Optimistic update so the marker layer flips instantly.
      const prev = queryClient.getQueryData<GlobalSettings>(['settings']);
      if (prev) {
        queryClient.setQueryData<GlobalSettings>(['settings'], { ...prev, chargersEnabled: enabled });
      }
      return { prev };
    },
    onError: (_err, _enabled, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(['settings'], ctx.prev);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['settings'] }),
  });

  const positions = driveId != null ? drivePositions : rangePositions;

  // Historical points (stable, only changes when range / drive switches).
  // When the user hides the route we drop the points entirely instead of
  // passing an empty array down — keeps the GeoJSON source out of the
  // MapLibre style and avoids an unnecessary diff on every toggle.
  const routePoints = useMemo(
    () =>
      routeVisible
        ? positions?.map((p) => [p.latitude, p.longitude] as [number, number]) ?? []
        : [],
    [positions, routeVisible],
  );

  // The live trail is sent as a separate prop so MQTT ticks don't refit bounds
  // and the camera doesn't snap back to the full historical trip.
  const liveTrail = liveActive ? liveTrace : undefined;

  const chargeMarkers = useMemo(
    () =>
      driveId != null
        ? []
        : charges
            ?.filter((c) => c.endDate && c.latitude != null && c.longitude != null)
            ?.slice(0, 20) ?? [],
    [charges, driveId],
  );

  const livePosition: LivePosition | null = liveActive
    ? {
        latitude: live!.latitude!,
        longitude: live!.longitude!,
        heading: live!.heading,
        connected,
      }
    : null;

  const clearParams = () => {
    setSearchParams({});
  };

  // ── Send-to-Vehicle mode ────────────────────────────────────────────
  // Activated via the bottom-right floating button. While active the map
  // de-emphasises historical trips and accepts taps to drop a destination
  // pin. We never enter this mode while inspecting a single drive — it
  // would conflict with the back-to-history flow.
  const [sendMode, setSendMode] = useState(false);
  const [destinationPin, setDestinationPin] = useState<{ latitude: number; longitude: number } | null>(
    null,
  );
  // Imperative camera target. We pass a fresh object to MapLibreMap each
  // time we want to recentre (search pick, charger pick, …) — comparing
  // by reference lets the same coordinate retrigger if needed.
  const [flyToCoords, setFlyToCoords] = useState<
    { latitude: number; longitude: number; zoom?: number } | null
  >(null);

  const closeSendMode = useCallback(() => {
    setSendMode(false);
    setDestinationPin(null);
    setFlyToCoords(null);
  }, []);

  // Whenever live-follow is engaged we disable it on entering send-mode so
  // the camera stops jumping to the vehicle while the user looks for a spot.
  useEffect(() => {
    if (sendMode && followLive) setFollowLive(false);
  }, [sendMode, followLive]);

  const handleMapClick = useCallback(
    (latitude: number, longitude: number) => {
      if (!sendMode) return;
      setDestinationPin({ latitude, longitude });
    },
    [sendMode],
  );

  const handlePinDragEnd = useCallback((latitude: number, longitude: number) => {
    setDestinationPin({ latitude, longitude });
  }, []);

  // Triggered from the charger popup → activates send-mode and pre-fills
  // the pin with the station's coordinates so the SendToCarPanel opens
  // straight to the address-resolved view.
  const handleSendChargerToCar = useCallback((latitude: number, longitude: number) => {
    setDestinationPin({ latitude, longitude });
    setSendMode(true);
    setFlyToCoords({ latitude, longitude, zoom: 16 });
  }, []);

  // Called by the SendToCarPanel when the user picks an autocomplete
  // suggestion. We both drop the pin AND fly the camera there — picking
  // a city from a search list and not seeing the map move was the whole
  // point of the bug fix that introduced this hook.
  const handleSearchSelect = useCallback(
    (latitude: number, longitude: number) => {
      setDestinationPin({ latitude, longitude });
      // City-grain zoom (≈14) — the same heuristic the camera effect
      // uses when the user is already zoomed out.
      setFlyToCoords({ latitude, longitude, zoom: 14 });
    },
    [],
  );

  const vehiclePosition = useMemo(() => {
    if (livePosition?.latitude != null && livePosition?.longitude != null) {
      return { latitude: livePosition.latitude, longitude: livePosition.longitude };
    }
    if (vehicle?.latitude != null && vehicle?.longitude != null) {
      return { latitude: vehicle.latitude, longitude: vehicle.longitude };
    }
    return null;
  }, [livePosition?.latitude, livePosition?.longitude, vehicle?.latitude, vehicle?.longitude]);

  return (
    <div className="flex flex-col h-[calc(100dvh-64px)]">
      {driveId != null ? (
        <div className="flex items-center gap-2 p-2 bg-[#0a0a0a]">
          <button
            onClick={clearParams}
            className="px-3 py-2 rounded-lg text-sm font-medium min-h-[40px] bg-[#1a1a1a] text-[#9ca3af] active:bg-[#2a2a2a]"
          >
            {t('map.back')}
          </button>
          <span className="text-sm text-white font-medium">{`${t('map.trip')} #${driveId}`}</span>
          <span className="text-xs text-[#9ca3af] ml-auto">
            {routePoints.length} {t('map.points')}
          </span>
        </div>
      ) : (
        <>
          {/* Range selector (scrollable on mobile) + always-visible live toggle */}
          <div className="flex items-stretch gap-2 p-2 bg-[#0a0a0a]">
            <div
              className="flex gap-1 flex-1 min-w-0 overflow-x-auto -mx-1 px-1 [&::-webkit-scrollbar]:hidden"
              style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
            >
              {RANGE_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  onClick={() => setRangeKey(opt.key)}
                  className={`flex-shrink-0 px-3 py-2 rounded-lg text-sm font-medium min-h-[40px] transition-colors duration-150 ${
                    rangeKey === opt.key ? 'bg-[#e31937] text-white' : 'bg-[#1a1a1a] text-[#9ca3af]'
                  }`}
                >
                  {opt.labelKey.startsWith('map.') ? t(opt.labelKey) : opt.labelKey}
                </button>
              ))}
            </div>

            {liveSupported && (
              <button
                onClick={() => setFollowLive((v) => !v)}
                disabled={!liveActive}
                title={liveActive ? '' : t('map.liveUnavailable')}
                className={`flex-shrink-0 inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium min-h-[40px] transition-colors duration-150 ${
                  followLive && liveActive
                    ? 'bg-[#22c55e] text-white'
                    : 'bg-[#1a1a1a] text-[#9ca3af]'
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    liveActive ? 'bg-white animate-pulse' : 'bg-[#6b7280]'
                  }`}
                />
                <span className="hidden sm:inline">
                  {followLive && liveActive ? t('map.followingLive') : t('map.followLive')}
                </span>
                <span className="sm:hidden">
                  {followLive && liveActive ? t('map.liveShort') : t('map.followShort')}
                </span>
              </button>
            )}

            {/* Toggle for the historical route layer. Off by default to keep
                the map fast on long ranges (a 30-day range can be tens of
                thousands of points). Hidden in single-drive mode where the
                route is the whole point of the page. */}
            <button
              onClick={() => setShowRoute((v) => !v)}
              title={t(showRoute ? 'map.hideRoute' : 'map.showRoute')}
              aria-pressed={showRoute}
              className={`flex-shrink-0 inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium min-h-[40px] transition-colors duration-150 ${
                showRoute
                  ? 'bg-[#a855f7] text-white active:bg-[#9333ea]'
                  : 'bg-[#1a1a1a] text-[#9ca3af] active:bg-[#2a2a2a]'
              }`}
            >
              <span aria-hidden="true">🛣</span>
              <span className="hidden sm:inline">
                {t(showRoute ? 'map.routeOn' : 'map.routeOff')}
              </span>
            </button>

            {/* Quick toggle for the public chargers layer. Only shown once
                the settings query has resolved so we don't render a stale
                state on first paint. */}
            {settings && (
              <button
                onClick={() => toggleChargers.mutate(!showPublicChargers)}
                disabled={toggleChargers.isPending}
                title={t(showPublicChargers ? 'map.hideChargers' : 'map.showChargers')}
                aria-pressed={showPublicChargers}
                className={`flex-shrink-0 inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium min-h-[40px] transition-colors duration-150 disabled:opacity-50 ${
                  showPublicChargers
                    ? 'bg-[#3b82f6] text-white active:bg-[#2563eb]'
                    : 'bg-[#1a1a1a] text-[#9ca3af] active:bg-[#2a2a2a]'
                }`}
              >
                <span aria-hidden="true">⚡</span>
                <span className="hidden sm:inline">
                  {t(showPublicChargers ? 'map.chargersOn' : 'map.chargersOff')}
                </span>
              </button>
            )}

            {/* "Send to Vehicle" lives in the top toolbar (rather than as a
                floating button on the map) so it never gets hidden by the
                mobile address bar, the on-map zoom controls, or the bottom
                safe-area inset. */}
            {!sendMode && (
              <button
                onClick={() => setSendMode(true)}
                title={t('sendToCar.title')}
                className="flex-shrink-0 inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium min-h-[40px] bg-[#e31937] text-white active:bg-[#c0152f] transition-colors duration-150"
              >
                <span aria-hidden="true">✈</span>
                <span className="hidden sm:inline">{t('sendToCar.openButton')}</span>
                <span className="sm:hidden">{t('sendToCar.openButtonShort')}</span>
              </button>
            )}
          </div>

          {/* Custom date inputs */}
          {rangeKey === 'custom' && (
            <div className="flex flex-wrap gap-2 px-2 pb-2 bg-[#0a0a0a]">
              <div className="flex gap-1 flex-1 min-w-0">
                <input
                  type="date"
                  value={customFromDate}
                  onChange={(e) => setCustomFromDate(e.target.value)}
                  className="flex-1 min-w-0 bg-[#141414] border border-[#2a2a2a] rounded-lg px-2 py-1.5 text-white text-xs focus:border-[#e31937] focus:outline-none min-h-[40px]"
                />
                <input
                  type="time"
                  value={customFromTime}
                  onChange={(e) => setCustomFromTime(e.target.value)}
                  className="bg-[#141414] border border-[#2a2a2a] rounded-lg px-2 py-1.5 text-white text-xs focus:border-[#e31937] focus:outline-none min-h-[40px] w-[80px]"
                />
              </div>
              <div className="flex gap-1 flex-1 min-w-0">
                <input
                  type="date"
                  value={customToDate}
                  onChange={(e) => setCustomToDate(e.target.value)}
                  className="flex-1 min-w-0 bg-[#141414] border border-[#2a2a2a] rounded-lg px-2 py-1.5 text-white text-xs focus:border-[#e31937] focus:outline-none min-h-[40px]"
                />
                <input
                  type="time"
                  value={customToTime}
                  onChange={(e) => setCustomToTime(e.target.value)}
                  className="bg-[#141414] border border-[#2a2a2a] rounded-lg px-2 py-1.5 text-white text-xs focus:border-[#e31937] focus:outline-none min-h-[40px] w-[80px]"
                />
              </div>
            </div>
          )}

          {/* Info bar */}
          <div className="flex items-center justify-between px-3 py-1.5 bg-[#141414] border-b border-[#2a2a2a] text-xs text-[#9ca3af]">
            <span>
              {!showRoute
                ? t('map.routeHidden')
                : routePoints.length > 0
                ? `${routePoints.length} ${t('map.points')}`
                : t('map.noData')}
            </span>
            <span>
              {chargeMarkers.length} {t('map.charges')}
              {liveActive && liveTrace.length > 0 && (
                <span className="ml-2 text-[#22c55e]">
                  · {liveTrace.length} {t('map.livePoints')}
                </span>
              )}
            </span>
          </div>
        </>
      )}

      {/* Map */}
      <div className="flex-1 relative">
        <MapLibreMap
          routePoints={routePoints}
          liveTrail={driveId != null ? undefined : liveTrail}
          chargeMarkers={chargeMarkers}
          livePosition={driveId != null ? null : livePosition}
          followLive={followLive && liveActive && driveId == null}
          onUserInteract={() => setFollowLive(false)}
          destinationPin={sendMode ? destinationPin : null}
          onDestinationDragEnd={sendMode ? handlePinDragEnd : undefined}
          onMapClick={sendMode ? handleMapClick : undefined}
          dimHistorical={sendMode}
          showPublicChargers={showPublicChargers}
          onSendChargerToCar={handleSendChargerToCar}
          flyTo={flyToCoords}
        />

        {sendMode && (
          <SendToCarPanel
            pin={destinationPin}
            onClose={closeSendMode}
            onPinChange={setDestinationPin}
            onSearchSelect={handleSearchSelect}
            vehiclePosition={vehiclePosition}
          />
        )}
      </div>
    </div>
  );
}
