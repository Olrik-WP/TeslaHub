import { MapContainer, TileLayer, Polyline, CircleMarker, Popup } from 'react-leaflet';

interface Position {
  latitude: number;
  longitude: number;
  date: string;
}

interface ChargeMarker {
  id: number;
  startDate: string;
  chargeEnergyAdded: number | null;
  address: string | null;
  fastChargerPresent: boolean | null;
}

interface LeafletMapProps {
  routePoints: [number, number][];
  chargeMarkers: ChargeMarker[];
  positions: Position[] | undefined;
  center: [number, number];
}

export default function LeafletMap({ routePoints, chargeMarkers, positions, center }: LeafletMapProps) {
  return (
    <MapContainer
      center={center}
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
          <Popup>Current position</Popup>
        </CircleMarker>
      )}

      {chargeMarkers.map((c) => {
        const pos = positions?.find(
          (p) => Math.abs(new Date(p.date).getTime() - new Date(c.startDate).getTime()) < 3600000
        );
        if (!pos) return null;
        return (
          <CircleMarker
            key={c.id}
            center={[pos.latitude, pos.longitude]}
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
