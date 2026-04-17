import { useRef, useEffect, useMemo, useState, useCallback } from 'react';
import { Map, Source, Layer, Marker, Popup } from 'react-map-gl/maplibre';
import type { MapRef } from 'react-map-gl/maplibre';
import type { LngLatBoundsLike } from 'maplibre-gl';
import { useTranslation } from 'react-i18next';
import { useMapStyle, setup3D } from '../hooks/useMapStyle';
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

interface LeafletMapProps {
  routePoints: [number, number][];
  chargeMarkers: ChargeMarker[];
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

export default function LeafletMap({ routePoints, chargeMarkers }: LeafletMapProps) {
  const { t } = useTranslation();
  const mapRef = useRef<MapRef>(null);
  const prevCount = useRef(0);
  const { styleUrl, pitch, bearing, is3D } = useMapStyle();
  const [popupInfo, setPopupInfo] = useState<ChargeMarker | null>(null);
  const [mapReady, setMapReady] = useState(false);

  const fallback = routePoints.length > 0 ? routePoints[routePoints.length - 1] : [48.8566, 2.3522] as [number, number];

  useEffect(() => {
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
  }, [routePoints]);

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
    return () => { map.off('style.load', apply); };
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
  }, [routePoints]);

  return (
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

      {routePoints.length > 0 && (
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
            onClick={(e) => { e.originalEvent.stopPropagation(); setPopupInfo(c); }}
          >
            <div style={DOT(c.fastChargerPresent ? '#f59e0b' : '#3b82f6', 12)} />
          </Marker>
        );
      })}

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
  );
}
