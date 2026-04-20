import { useRef, useEffect, useMemo, useState, useCallback } from 'react';
import { Map, Source, Layer, Marker, Popup, NavigationControl } from 'react-map-gl/maplibre';
import type { MapRef, MapLayerMouseEvent } from 'react-map-gl/maplibre';
import type { LngLatBoundsLike } from 'maplibre-gl';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useMapStyle, setup3D } from '../hooks/useMapStyle';
import MapStylePicker from './MapStylePicker';
import { getChargers, type PublicCharger, type ChargerConnection } from '../api/queries';
import 'maplibre-gl/dist/maplibre-gl.css';

interface ChargeMarker {
  id: number;
  startDate: string;
  chargeEnergyAdded: number | null;
  address: string | null;
  fastChargerPresent: boolean | null;
  latitude?: number | null;
  longitude?: number | null;
}

export interface LivePosition {
  latitude: number;
  longitude: number;
  heading?: number | null;
  connected: boolean;
}

interface MapLibreMapProps {
  /** Historical route points. Used for the auto-fit bounds on first load and
   *  whenever the dataset changes (range/drive switch). */
  routePoints: [number, number][];
  /** Optional live trail accumulated client-side. Drawn as part of the route
   *  line but never triggers an auto-fit (otherwise every MQTT tick would
   *  yank the camera back to the full trip). */
  liveTrail?: [number, number][];
  chargeMarkers: ChargeMarker[];
  livePosition?: LivePosition | null;
  followLive?: boolean;
  /** Called when the user manually pans/zooms while live-follow is active.
   *  Lets the parent disable the auto-follow so the camera stops fighting the user. */
  onUserInteract?: () => void;
  /** Optional destination marker for the "Send to Vehicle" mode. */
  destinationPin?: { latitude: number; longitude: number } | null;
  /** Called when the destination pin is dragged to a new spot. */
  onDestinationDragEnd?: (latitude: number, longitude: number) => void;
  /** Called when the user taps anywhere on the map (used in destination mode). */
  onMapClick?: (latitude: number, longitude: number) => void;
  /** Visually de-emphasise historical trips/charges. */
  dimHistorical?: boolean;
  /** Render the public chargers (Open Charge Map) layer.
   *  Disabled by default; controlled by the user from Settings. */
  showPublicChargers?: boolean;
  /** When provided, the charger popup shows a "Send to Vehicle" button
   *  that pre-fills the destination pin with the station's coordinates. */
  onSendChargerToCar?: (latitude: number, longitude: number) => void;
}

const CHARGER_SOURCE_ID = 'public-chargers';
const CHARGER_CLUSTER_LAYER = 'public-chargers-clusters';
const CHARGER_CLUSTER_COUNT_LAYER = 'public-chargers-cluster-count';
const CHARGER_POINT_LAYER = 'public-chargers-points';
const CHARGER_MIN_ZOOM = 8;

// Power-tier colours, aligned with what most EV apps (ABRP, Chargemap,
// PlugShare) use so seasoned EV drivers read the map at a glance.
//   < 22 kW   slow AC          green
//   < 50 kW   fast AC / DC     yellow
//   < 150 kW  fast DC          orange
//   < 250 kW  ultra-rapid DC   red
//   ≥ 250 kW  hyper-charger    purple
//   unknown                    gray
const POWER_COLOR_EXPRESSION = [
  'case',
  ['==', ['coalesce', ['get', 'powerKw'], -1], -1], '#6b7280',
  ['<', ['get', 'powerKw'], 22], '#22c55e',
  ['<', ['get', 'powerKw'], 50], '#eab308',
  ['<', ['get', 'powerKw'], 150], '#f97316',
  ['<', ['get', 'powerKw'], 250], '#ef4444',
  '#a855f7',
] as unknown as string;

function powerColor(power: number | null | undefined): string {
  if (power == null) return '#6b7280';
  if (power < 22) return '#22c55e';
  if (power < 50) return '#eab308';
  if (power < 150) return '#f97316';
  if (power < 250) return '#ef4444';
  return '#a855f7';
}

const DOT = (color: string, size: number): React.CSSProperties => ({
  width: size,
  height: size,
  borderRadius: '50%',
  background: color,
  border: '2px solid #fff',
  boxShadow: '0 0 4px rgba(0,0,0,.3)',
  cursor: 'pointer',
});

// Smoothly interpolate between two coordinates over time using rAF.
// Avoids the "teleporting" effect when MQTT pushes a new position.
function useInterpolatedPosition(
  target: { latitude: number; longitude: number } | null | undefined,
  durationMs = 1000,
) {
  const [displayed, setDisplayed] = useState<{ latitude: number; longitude: number } | null>(
    target ?? null,
  );
  const fromRef = useRef<{ latitude: number; longitude: number } | null>(target ?? null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!target) {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      setDisplayed(null);
      fromRef.current = null;
      return;
    }
    if (!fromRef.current) {
      setDisplayed(target);
      fromRef.current = target;
      return;
    }
    if (
      fromRef.current.latitude === target.latitude &&
      fromRef.current.longitude === target.longitude
    ) {
      return;
    }

    const from = fromRef.current;
    const startTime = performance.now();

    const step = (now: number) => {
      const t = Math.min(1, (now - startTime) / durationMs);
      const ease = 1 - Math.pow(1 - t, 3); // easeOutCubic
      const lat = from.latitude + (target.latitude - from.latitude) * ease;
      const lng = from.longitude + (target.longitude - from.longitude) * ease;
      setDisplayed({ latitude: lat, longitude: lng });
      if (t < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        fromRef.current = target;
        rafRef.current = null;
      }
    };

    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(step);

    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      fromRef.current = target;
    };
  }, [target?.latitude, target?.longitude, durationMs]);

  return displayed;
}

function LiveMarker({ heading, connected }: { heading: number | null | undefined; connected: boolean }) {
  return (
    <div className="relative" style={{ width: 28, height: 28, pointerEvents: 'none' }}>
      {connected && (
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background: '#e31937',
            opacity: 0.35,
            animation: 'teslahub-live-ping 1.6s cubic-bezier(0,0,0.2,1) infinite',
          }}
        />
      )}
      <div
        className="absolute inset-[6px] rounded-full flex items-center justify-center"
        style={{
          background: '#e31937',
          border: '2px solid #fff',
          boxShadow: '0 0 6px rgba(0,0,0,.45)',
        }}
      >
        {heading != null && (
          <div
            style={{
              transform: `rotate(${heading}deg)`,
              transition: 'transform 600ms ease-out',
              width: 10,
              height: 10,
              color: '#fff',
              lineHeight: '10px',
              fontSize: 12,
              fontWeight: 'bold',
            }}
          >
            ▲
          </div>
        )}
      </div>
    </div>
  );
}

export default function MapLibreMap({
  routePoints,
  liveTrail,
  chargeMarkers,
  livePosition,
  followLive = false,
  onUserInteract,
  destinationPin = null,
  onDestinationDragEnd,
  onMapClick,
  dimHistorical = false,
  showPublicChargers = false,
  onSendChargerToCar,
}: MapLibreMapProps) {
  const { t } = useTranslation();
  const mapRef = useRef<MapRef>(null);
  const prevCount = useRef(0);
  const { styleUrl, pitch, bearing, is3D } = useMapStyle();
  const [popupInfo, setPopupInfo] = useState<ChargeMarker | null>(null);
  const [chargerPopup, setChargerPopup] = useState<PublicCharger | null>(null);
  const [mapReady, setMapReady] = useState(false);

  // Visible bbox, refreshed on every moveend. Snapped to ~0.05° so identical
  // pans don't kick off duplicate requests. The backend additionally caches
  // by 0.5° tiles, so cache hits are cheap on top of that.
  const [bbox, setBbox] = useState<{ south: number; west: number; north: number; east: number } | null>(null);
  const [zoom, setZoom] = useState<number>(13);

  useEffect(() => {
    if (!mapReady || !showPublicChargers) return;
    const map = mapRef.current?.getMap();
    if (!map) return;

    const update = () => {
      const b = map.getBounds();
      const round = (n: number) => Math.round(n * 20) / 20;
      setBbox({
        south: round(b.getSouth()),
        west: round(b.getWest()),
        north: round(b.getNorth()),
        east: round(b.getEast()),
      });
      setZoom(map.getZoom());
    };

    update();
    map.on('moveend', update);
    return () => {
      map.off('moveend', update);
    };
  }, [mapReady, showPublicChargers]);

  // Skip the request entirely when zoomed out — at world-scale OCM would
  // return only a sample anyway, and the resulting blob would dwarf the
  // useful detail.
  const chargersEnabled = showPublicChargers && bbox !== null && zoom >= CHARGER_MIN_ZOOM;
  const { data: chargers } = useQuery({
    queryKey: ['publicChargers', bbox],
    queryFn: () => getChargers(bbox!),
    enabled: chargersEnabled,
    staleTime: 10 * 60_000,
    gcTime: 60 * 60_000,
  });

  // Wrap the chargers as a clustered GeoJSON source. Using the native
  // MapLibre cluster + `circle` layers scales to thousands of points
  // without any DOM cost (compare React `<Marker>` which dies past ~500).
  // Nested arrays (connections) are stringified because MapLibre feature
  // properties have to be primitives — we deserialise on click.
  const chargersGeoJson = useMemo(() => {
    if (!chargers || chargers.length === 0) {
      return { type: 'FeatureCollection' as const, features: [] };
    }
    return {
      type: 'FeatureCollection' as const,
      features: chargers.map((c) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [c.longitude, c.latitude] },
        properties: {
          ...c,
          // MapLibre property store is flat — JSON-encode nested data.
          connections: JSON.stringify(c.connections),
        },
      })),
    };
  }, [chargers]);

  // Click handler: clusters expand, single points open a popup.
  const handleChargerLayerClick = useCallback((e: MapLayerMouseEvent) => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    const features = map.queryRenderedFeatures(e.point, {
      layers: [CHARGER_CLUSTER_LAYER, CHARGER_POINT_LAYER],
    });
    if (features.length === 0) return;
    const feat = features[0];
    if (feat.layer.id === CHARGER_CLUSTER_LAYER) {
      const clusterId = feat.properties?.cluster_id;
      const source = map.getSource(CHARGER_SOURCE_ID) as
        | { getClusterExpansionZoom: (id: number, cb: (err: unknown, zoom?: number) => void) => void }
        | undefined;
      if (clusterId != null && source) {
        source.getClusterExpansionZoom(clusterId, (err, expZoom) => {
          if (err || expZoom == null) return;
          const coords = (feat.geometry as unknown as { coordinates: [number, number] }).coordinates;
          map.easeTo({ center: coords, zoom: expZoom + 0.1, duration: 500 });
        });
      }
      return;
    }
    // Single point — open the popup. Properties came in as primitives;
    // unwrap the JSON-encoded connections list.
    const rawProps = feat.properties as (Omit<PublicCharger, 'connections'> & { connections?: string }) | undefined;
    if (rawProps) {
      const coords = (feat.geometry as unknown as { coordinates: [number, number] }).coordinates;
      let connections: ChargerConnection[] = [];
      try {
        connections = rawProps.connections ? JSON.parse(rawProps.connections) : [];
      } catch {
        connections = [];
      }
      setChargerPopup({
        ...rawProps,
        connections,
        longitude: coords[0],
        latitude: coords[1],
      } as PublicCharger);
    }
  }, []);

  const liveTarget = useMemo(
    () =>
      livePosition && livePosition.latitude != null && livePosition.longitude != null
        ? { latitude: livePosition.latitude, longitude: livePosition.longitude }
        : null,
    [livePosition?.latitude, livePosition?.longitude],
  );
  const animatedLive = useInterpolatedPosition(liveTarget, 900);

  const fallback =
    livePosition && livePosition.latitude != null && livePosition.longitude != null
      ? ([livePosition.latitude, livePosition.longitude] as [number, number])
      : routePoints.length > 0
        ? routePoints[routePoints.length - 1]
        : ([48.8566, 2.3522] as [number, number]);

  // Auto-fit on route changes — disabled in live-follow mode (the live effect handles the camera).
  useEffect(() => {
    if (followLive) return;
    const map = mapRef.current?.getMap();
    if (!map || routePoints.length === 0) return;
    if (routePoints.length === prevCount.current) return;
    prevCount.current = routePoints.length;

    if (routePoints.length === 1) {
      map.flyTo({ center: [routePoints[0][1], routePoints[0][0]], zoom: 16 });
    } else {
      const lngs = routePoints.map((p) => p[1]);
      const lats = routePoints.map((p) => p[0]);
      const bounds: LngLatBoundsLike = [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ];
      map.fitBounds(bounds, { padding: 40, maxZoom: 15 });
    }
  }, [routePoints, followLive]);

  // Track whether the most recent camera move came from our follow effect, so
  // we can ignore it when watching for user-initiated interactions.
  const programmaticMoveRef = useRef(false);

  // Live-follow: recenter once per actual MQTT update (NOT on every interpolation
  // frame, otherwise easeTo calls keep cancelling each other and the map lags).
  // We bake pitch/bearing into the same easeTo so it cannot be overwritten by the
  // pitch/bearing-only easeTo from the 3D effect (race at mount).
  useEffect(() => {
    if (!followLive || !mapReady || livePosition?.latitude == null || livePosition?.longitude == null) return;
    const map = mapRef.current?.getMap();
    if (!map) return;
    programmaticMoveRef.current = true;
    map.easeTo({
      center: [livePosition.longitude, livePosition.latitude],
      pitch,
      bearing,
      duration: 900,
    });
  }, [followLive, mapReady, livePosition?.latitude, livePosition?.longitude, pitch, bearing]);

  // Detect manual user interaction (drag / wheel zoom / touch) and let the parent
  // disable auto-follow. The internal flag lets us ignore programmatic easeTo events.
  useEffect(() => {
    if (!followLive || !mapReady || !onUserInteract) return;
    const map = mapRef.current?.getMap();
    if (!map) return;

    const handleStart = () => {
      if (programmaticMoveRef.current) {
        programmaticMoveRef.current = false;
        return;
      }
      onUserInteract();
    };

    map.on('dragstart', handleStart);
    map.on('wheel', handleStart);
    map.on('touchstart', handleStart);
    return () => {
      map.off('dragstart', handleStart);
      map.off('wheel', handleStart);
      map.off('touchstart', handleStart);
    };
  }, [followLive, mapReady, onUserInteract]);

  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current?.getMap();
    if (!map) return;

    const apply = () => {
      if (!map.isStyleLoaded()) return;
      if (is3D) {
        setup3D(map);
        // In follow-mode the live-follow effect already animates pitch/bearing
        // alongside the camera center — skipping here avoids racing easeTo calls.
        if (!followLive) {
          map.easeTo({ pitch, bearing, duration: 1000 });
        }
      } else {
        if (map.getTerrain()) map.setTerrain(null);
        if (map.getLayer('3d-buildings')) map.removeLayer('3d-buildings');
        if (map.getSource('terrainSource')) map.removeSource('terrainSource');
        if (!followLive) {
          map.easeTo({ pitch: 0, bearing: 0, duration: 1000 });
        }
      }
    };

    apply();
    map.on('style.load', apply);
    return () => {
      map.off('style.load', apply);
    };
  }, [is3D, pitch, bearing, mapReady, followLive]);

  const routeGeoJson = useMemo(() => {
    const all = liveTrail && liveTrail.length > 0 ? [...routePoints, ...liveTrail] : routePoints;
    if (all.length < 2) return null;
    return {
      type: 'Feature' as const,
      properties: {},
      geometry: {
        type: 'LineString' as const,
        coordinates: all.map(([lat, lng]) => [lng, lat]),
      },
    };
  }, [routePoints, liveTrail]);

  const handleLoad = useCallback(() => {
    setMapReady(true);
    const map = mapRef.current?.getMap();
    if (!map) return;

    if (followLive && livePosition?.latitude != null && livePosition?.longitude != null) {
      // Use jumpTo (instant) instead of flyTo so the live-follow easeTo that
      // fires on the same tick can take over cleanly without fighting an
      // in-progress fly animation.
      map.jumpTo({
        center: [livePosition.longitude, livePosition.latitude],
        zoom: 15,
      });
      return;
    }

    if (routePoints.length === 1) {
      map.flyTo({ center: [routePoints[0][1], routePoints[0][0]], zoom: 16 });
    } else if (routePoints.length > 1) {
      const lngs = routePoints.map((p) => p[1]);
      const lats = routePoints.map((p) => p[0]);
      const bounds: LngLatBoundsLike = [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ];
      map.fitBounds(bounds, { padding: 40, maxZoom: 15 });
    }
    prevCount.current = routePoints.length;
  }, [routePoints, followLive, livePosition?.latitude, livePosition?.longitude]);

  return (
    <div className="relative w-full h-full">
      <style>{`
        @keyframes teslahub-live-ping {
          0%   { transform: scale(0.8); opacity: 0.55; }
          80%  { transform: scale(2.0); opacity: 0;    }
          100% { transform: scale(2.0); opacity: 0;    }
        }
      `}</style>
      <Map
        ref={mapRef}
        initialViewState={{
          longitude: fallback[1],
          latitude: fallback[0],
          zoom: 13,
          pitch,
          bearing,
        }}
        mapStyle={styleUrl}
        attributionControl={false}
        style={{ width: '100%', height: '100%' }}
        onLoad={handleLoad}
        interactiveLayerIds={
          showPublicChargers ? [CHARGER_CLUSTER_LAYER, CHARGER_POINT_LAYER] : undefined
        }
        onClick={(e) => {
          // Charger interactions take priority over destination drops so the
          // user can read a station's details without setting a pin on top of it.
          if (showPublicChargers) {
            const map = mapRef.current?.getMap();
            const hit = map?.queryRenderedFeatures(e.point, {
              layers: [CHARGER_CLUSTER_LAYER, CHARGER_POINT_LAYER],
            });
            if (hit && hit.length > 0) {
              handleChargerLayerClick(e);
              return;
            }
          }
          if (!onMapClick) return;
          onMapClick(e.lngLat.lat, e.lngLat.lng);
        }}
        cursor={onMapClick ? 'crosshair' : undefined}
      >
        <NavigationControl
          position="top-left"
          showZoom
          showCompass
          visualizePitch
        />

        {showPublicChargers && (
          <Source
            id={CHARGER_SOURCE_ID}
            type="geojson"
            data={chargersGeoJson}
            cluster
            clusterMaxZoom={12}
            clusterRadius={45}
          >
            <Layer
              id={CHARGER_CLUSTER_LAYER}
              type="circle"
              filter={['has', 'point_count']}
              paint={{
                'circle-color': [
                  'step',
                  ['get', 'point_count'],
                  '#3b82f6', 10,
                  '#f59e0b', 50,
                  '#e31937',
                ],
                'circle-radius': [
                  'step',
                  ['get', 'point_count'],
                  16, 10,
                  20, 50,
                  26,
                ],
                'circle-stroke-color': '#ffffff',
                'circle-stroke-width': 2,
                'circle-opacity': dimHistorical ? 0.55 : 0.9,
              }}
            />
            <Layer
              id={CHARGER_CLUSTER_COUNT_LAYER}
              type="symbol"
              filter={['has', 'point_count']}
              layout={{
                'text-field': '{point_count_abbreviated}',
                'text-font': ['Noto Sans Regular'],
                'text-size': 12,
              }}
              paint={{
                'text-color': '#ffffff',
              }}
            />
            <Layer
              id={CHARGER_POINT_LAYER}
              type="circle"
              filter={['!', ['has', 'point_count']]}
              paint={{
                'circle-color': POWER_COLOR_EXPRESSION,
                'circle-radius': [
                  'interpolate', ['linear'], ['zoom'],
                  8, 4,
                  12, 6,
                  16, 8,
                ],
                // Tesla sites get a black ring so they stand out from
                // third-party stations of the same power tier.
                'circle-stroke-color': [
                  'match',
                  ['get', 'category'],
                  'tesla-supercharger', '#000000',
                  'tesla-destination', '#000000',
                  '#ffffff',
                ],
                'circle-stroke-width': [
                  'match',
                  ['get', 'category'],
                  'tesla-supercharger', 2,
                  'tesla-destination', 2,
                  1.5,
                ],
                'circle-opacity': dimHistorical ? 0.55 : 1,
              }}
            />
          </Source>
        )}

        {routeGeoJson && (
          <Source id="route" type="geojson" data={routeGeoJson}>
            <Layer
              id="route-line"
              type="line"
              paint={{
                'line-color': '#e31937',
                'line-width': 3,
                'line-opacity': dimHistorical ? 0.2 : 0.8,
              }}
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
            />
          </Source>
        )}

        {/* Static last-position dot only when not in live mode (live marker takes over) */}
        {!livePosition && routePoints.length > 0 && (
          <Marker
            longitude={routePoints[routePoints.length - 1][1]}
            latitude={routePoints[routePoints.length - 1][0]}
            anchor="center"
          >
            <div style={DOT('#e31937', 16)} title={t('map.lastPosition')} />
          </Marker>
        )}

        {routePoints.length > 1 && (
          <Marker
            longitude={routePoints[0][1]}
            latitude={routePoints[0][0]}
            anchor="center"
          >
            <div style={DOT('#22c55e', 12)} title={t('map.start')} />
          </Marker>
        )}

        {chargeMarkers.map((c) => {
          if (c.latitude == null || c.longitude == null) return null;
          return (
            <Marker
              key={c.id}
              longitude={c.longitude}
              latitude={c.latitude}
              anchor="center"
              onClick={(e) => {
                e.originalEvent.stopPropagation();
                setPopupInfo(c);
              }}
            >
              <div
                style={{
                  ...DOT(c.fastChargerPresent ? '#f59e0b' : '#3b82f6', 12),
                  opacity: dimHistorical ? 0.35 : 1,
                }}
              />
            </Marker>
          );
        })}

        {animatedLive && livePosition && (
          <Marker
            longitude={animatedLive.longitude}
            latitude={animatedLive.latitude}
            anchor="center"
          >
            <LiveMarker heading={livePosition.heading} connected={livePosition.connected} />
          </Marker>
        )}

        {destinationPin && (
          <Marker
            longitude={destinationPin.longitude}
            latitude={destinationPin.latitude}
            anchor="bottom"
            draggable
            onDragEnd={(e) => {
              if (onDestinationDragEnd) onDestinationDragEnd(e.lngLat.lat, e.lngLat.lng);
            }}
          >
            <div
              style={{
                width: 28,
                height: 36,
                cursor: 'grab',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                filter: 'drop-shadow(0 2px 3px rgba(0,0,0,.45))',
              }}
            >
              <svg width="28" height="36" viewBox="0 0 28 36" fill="none">
                <path
                  d="M14 0C6.27 0 0 6.27 0 14c0 9 14 22 14 22s14-13 14-22C28 6.27 21.73 0 14 0z"
                  fill="#e31937"
                  stroke="#fff"
                  strokeWidth="2"
                />
                <circle cx="14" cy="14" r="5" fill="#fff" />
              </svg>
            </div>
          </Marker>
        )}

        {popupInfo && popupInfo.latitude != null && popupInfo.longitude != null && (
          <Popup
            longitude={popupInfo.longitude}
            latitude={popupInfo.latitude}
            anchor="bottom"
            onClose={() => setPopupInfo(null)}
            closeOnClick={false}
            className="text-black"
          >
            <div className="text-xs">
              <div>{popupInfo.chargeEnergyAdded?.toFixed(1)} kWh</div>
              <div>{popupInfo.address?.split(',')[0]}</div>
            </div>
          </Popup>
        )}

        {chargerPopup && (
          <Popup
            longitude={chargerPopup.longitude}
            latitude={chargerPopup.latitude}
            anchor="bottom"
            onClose={() => setChargerPopup(null)}
            closeOnClick={false}
            className="text-black"
            maxWidth="320px"
          >
            <div className="text-xs space-y-2 min-w-[240px]">
              <div>
                <div className="font-semibold text-sm leading-tight pr-4">
                  {chargerPopup.title}
                </div>
                <div className="text-[11px] text-[#6b7280] mt-0.5">
                  {chargerPopup.operatorWebsite ? (
                    <a
                      href={chargerPopup.operatorWebsite}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:underline"
                    >
                      {chargerPopup.network} ↗
                    </a>
                  ) : (
                    chargerPopup.network
                  )}
                </div>
              </div>

              {(chargerPopup.address || chargerPopup.city) && (
                <div className="text-[11px] text-[#4b5563]">
                  {[chargerPopup.address, chargerPopup.city].filter(Boolean).join(', ')}
                </div>
              )}

              <div className="flex flex-wrap gap-x-2 gap-y-1 pt-0.5">
                {chargerPopup.powerKw != null && (
                  <span
                    className="px-1.5 py-0.5 rounded text-[10px] font-semibold text-white"
                    style={{ background: powerColor(chargerPopup.powerKw) }}
                  >
                    {chargerPopup.powerKw} kW
                  </span>
                )}
                {chargerPopup.connectorCount > 0 && (
                  <span className="px-1.5 py-0.5 rounded text-[10px] bg-[#1f2937] text-white">
                    🔌 ×{chargerPopup.connectorCount}
                  </span>
                )}
                {chargerPopup.usageType && (
                  <span className="px-1.5 py-0.5 rounded text-[10px] bg-[#374151] text-white">
                    {chargerPopup.usageType}
                  </span>
                )}
                {chargerPopup.operationalStatus && (
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                      chargerPopup.isOperational
                        ? 'bg-[#dcfce7] text-[#166534]'
                        : 'bg-[#fee2e2] text-[#991b1b]'
                    }`}
                  >
                    {chargerPopup.operationalStatus}
                  </span>
                )}
              </div>

              {chargerPopup.connections.length > 0 && (
                <div className="border-t border-[#e5e7eb] pt-1.5 space-y-0.5">
                  {chargerPopup.connections.slice(0, 5).map((conn, idx) => (
                    <div key={idx} className="flex items-center gap-1.5 text-[11px]">
                      <span className="font-medium text-[#374151] flex-1 truncate">
                        {conn.type}
                      </span>
                      <span className="text-[#6b7280]">
                        {conn.powerKw != null ? `${conn.powerKw} kW` : ''}
                        {conn.currentType ? ` · ${conn.currentType}` : ''}
                      </span>
                      {conn.quantity > 1 && (
                        <span className="text-[#9ca3af] tabular-nums">×{conn.quantity}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div className="flex gap-1.5 pt-1">
                {onSendChargerToCar && (
                  <button
                    type="button"
                    onClick={() => {
                      onSendChargerToCar(chargerPopup.latitude, chargerPopup.longitude);
                      setChargerPopup(null);
                    }}
                    className="flex-1 bg-[#e31937] text-white px-2 py-1.5 rounded text-[11px] font-semibold hover:bg-[#c0152f] flex items-center justify-center gap-1"
                  >
                    <span aria-hidden>✈</span>
                    {t('chargers.sendToCar')}
                  </button>
                )}
                <a
                  href={`https://www.google.com/maps/dir/?api=1&destination=${chargerPopup.latitude},${chargerPopup.longitude}&travelmode=driving`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 bg-[#1f2937] text-white px-2 py-1.5 rounded text-[11px] font-medium hover:bg-[#374151] text-center"
                >
                  {t('chargers.openInMaps')}
                </a>
              </div>

              <div className="text-[9px] text-[#9ca3af] pt-1 border-t border-[#e5e7eb]">
                {t('chargers.attribution')}{' '}
                <a
                  href="https://openchargemap.org/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  Open Charge Map
                </a>{' '}
                · CC-BY-SA
              </div>
            </div>
          </Popup>
        )}
      </Map>

      {/* Power-tier legend, only when the layer is on. Compact / mobile-first. */}
      {showPublicChargers && chargers && chargers.length > 0 && (
        <div className="absolute bottom-2 left-2 z-10 bg-[#0a0a0a]/85 backdrop-blur-sm border border-[#2a2a2a] rounded-lg px-2 py-1.5 text-[10px] text-white pointer-events-none">
          <div className="text-[#9ca3af] uppercase tracking-wider mb-1 text-[9px]">
            {t('chargers.legend.title')}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {[
              { color: '#22c55e', label: '< 22' },
              { color: '#eab308', label: '< 50' },
              { color: '#f97316', label: '< 150' },
              { color: '#ef4444', label: '< 250' },
              { color: '#a855f7', label: '≥ 250' },
            ].map((tier) => (
              <span key={tier.label} className="inline-flex items-center gap-1">
                <span
                  className="w-2.5 h-2.5 rounded-full border border-white"
                  style={{ background: tier.color }}
                />
                <span>{tier.label}</span>
              </span>
            ))}
            <span className="text-[#9ca3af]">kW</span>
          </div>
        </div>
      )}
      <MapStylePicker />
    </div>
  );
}
