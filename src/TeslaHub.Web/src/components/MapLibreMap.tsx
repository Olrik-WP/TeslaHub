import { useRef, useEffect, useMemo, useState, useCallback } from 'react';
import { Map, Source, Layer, Marker, Popup, NavigationControl } from 'react-map-gl/maplibre';
import type { MapRef } from 'react-map-gl/maplibre';
import type { LngLatBoundsLike } from 'maplibre-gl';
import { useTranslation } from 'react-i18next';
import { useMapStyle, setup3D } from '../hooks/useMapStyle';
import MapStylePicker from './MapStylePicker';
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
  routePoints: [number, number][];
  chargeMarkers: ChargeMarker[];
  livePosition?: LivePosition | null;
  followLive?: boolean;
  /** Called when the user manually pans/zooms while live-follow is active.
   *  Lets the parent disable the auto-follow so the camera stops fighting the user. */
  onUserInteract?: () => void;
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
  chargeMarkers,
  livePosition,
  followLive = false,
  onUserInteract,
}: MapLibreMapProps) {
  const { t } = useTranslation();
  const mapRef = useRef<MapRef>(null);
  const prevCount = useRef(0);
  const { styleUrl, pitch, bearing, is3D } = useMapStyle();
  const [popupInfo, setPopupInfo] = useState<ChargeMarker | null>(null);
  const [mapReady, setMapReady] = useState(false);

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

  // Live-follow: smoothly recenter on the moving vehicle.
  useEffect(() => {
    if (!followLive || !mapReady || !animatedLive) return;
    const map = mapRef.current?.getMap();
    if (!map) return;
    programmaticMoveRef.current = true;
    const targetBearing =
      livePosition?.heading != null && Number.isFinite(livePosition.heading)
        ? livePosition.heading
        : undefined;
    map.easeTo({
      center: [animatedLive.longitude, animatedLive.latitude],
      ...(targetBearing != null ? { bearing: targetBearing } : {}),
      duration: 600,
      easing: (n) => n,
    });
  }, [followLive, mapReady, animatedLive?.latitude, animatedLive?.longitude, livePosition?.heading]);

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
        map.easeTo({ pitch, bearing, duration: 1000 });
      } else {
        if (map.getTerrain()) map.setTerrain(null);
        if (map.getLayer('3d-buildings')) map.removeLayer('3d-buildings');
        if (map.getSource('terrainSource')) map.removeSource('terrainSource');
        map.easeTo({ pitch: 0, bearing: 0, duration: 1000 });
      }
    };

    apply();
    map.on('style.load', apply);
    return () => {
      map.off('style.load', apply);
    };
  }, [is3D, pitch, bearing, mapReady]);

  const routeGeoJson = useMemo(() => {
    if (routePoints.length < 2) return null;
    return {
      type: 'Feature' as const,
      properties: {},
      geometry: {
        type: 'LineString' as const,
        coordinates: routePoints.map(([lat, lng]) => [lng, lat]),
      },
    };
  }, [routePoints]);

  const handleLoad = useCallback(() => {
    setMapReady(true);
    const map = mapRef.current?.getMap();
    if (!map) return;

    if (followLive && livePosition?.latitude != null && livePosition?.longitude != null) {
      map.flyTo({
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
      >
        <NavigationControl
          position="top-left"
          showZoom
          showCompass
          visualizePitch
        />

        {routeGeoJson && (
          <Source id="route" type="geojson" data={routeGeoJson}>
            <Layer
              id="route-line"
              type="line"
              paint={{
                'line-color': '#e31937',
                'line-width': 3,
                'line-opacity': 0.8,
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
              <div style={DOT(c.fastChargerPresent ? '#f59e0b' : '#3b82f6', 12)} />
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
      </Map>
      <MapStylePicker />
    </div>
  );
}
