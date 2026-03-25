import { useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Polyline, CircleMarker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';

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

function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap();
  const prevCount = useRef(0);

  useEffect(() => {
    if (points.length < 2) return;
    if (points.length === prevCount.current) return;

    const bounds = L.latLngBounds(points.map(([lat, lng]) => L.latLng(lat, lng)));
    map.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 });
    prevCount.current = points.length;
  }, [map, points]);

  return null;
}

export default function LeafletMap({ routePoints, chargeMarkers }: LeafletMapProps) {
  const fallback: [number, number] = routePoints.length > 0 ? routePoints[routePoints.length - 1] : [48.8566, 2.3522];

  return (
    <MapContainer
      center={fallback}
      zoom={13}
      className="w-full h-full"
      zoomControl={false}
      attributionControl={false}
    >
      <TileLayer
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        maxZoom={19}
        className="dark-mode-tiles"
      />

      <FitBounds points={routePoints} />

      {routePoints.length > 1 && (
        <Polyline positions={routePoints} color="#e31937" weight={3} opacity={0.8} />
      )}

      {routePoints.length > 0 && (
        <CircleMarker
          center={routePoints[routePoints.length - 1]}
          radius={8}
          fillColor="#e31937"
          fillOpacity={1}
          color="#ffffff"
          weight={2}
        >
          <Popup>Last position</Popup>
        </CircleMarker>
      )}

      {routePoints.length > 0 && (
        <CircleMarker
          center={routePoints[0]}
          radius={6}
          fillColor="#22c55e"
          fillOpacity={1}
          color="#ffffff"
          weight={2}
        >
          <Popup>Start</Popup>
        </CircleMarker>
      )}

      {chargeMarkers.map((c) => {
        if (c.latitude == null || c.longitude == null) return null;
        return (
          <CircleMarker
            key={c.id}
            center={[c.latitude, c.longitude]}
            radius={6}
            fillColor={c.fastChargerPresent ? '#f59e0b' : '#3b82f6'}
            fillOpacity={1}
            color="#ffffff"
            weight={2}
          >
            <Popup>
              <div className="text-xs">
                <div>{c.chargeEnergyAdded?.toFixed(1)} kWh</div>
                <div>{c.address?.split(',')[0]}</div>
              </div>
            </Popup>
          </CircleMarker>
        );
      })}
    </MapContainer>
  );
}
