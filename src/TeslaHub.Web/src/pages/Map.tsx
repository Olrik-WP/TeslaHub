import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getRecentPositions, getChargingSessions } from '../api/queries';
import { useGeoLocation } from '../hooks/useGeoLocation';
import WazeEmbed from '../components/WazeEmbed';
import LeafletMap from '../components/LeafletMap';

interface Props {
  carId: number | undefined;
}

type Tab = 'history' | 'waze';

export default function MapPage({ carId }: Props) {
  const [tab, setTab] = useState<Tab>('history');
  const { position: gpsPosition } = useGeoLocation();

  const { data: positions } = useQuery({
    queryKey: ['recentPositions', carId],
    queryFn: () => getRecentPositions(carId!, 48),
    enabled: !!carId,
    staleTime: 30_000,
  });

  const { data: charges } = useQuery({
    queryKey: ['chargingForMap', carId],
    queryFn: () => getChargingSessions(carId!, 10),
    enabled: !!carId,
  });

  const routePoints =
    positions?.map((p) => [p.latitude, p.longitude] as [number, number]) ?? [];

  const chargeMarkers =
    charges
      ?.filter((c) => c.endDate)
      ?.slice(0, 10) ?? [];

  const defaultCenter: [number, number] =
    routePoints.length > 0
      ? routePoints[routePoints.length - 1]
      : gpsPosition
      ? [gpsPosition.lat, gpsPosition.lng]
      : [48.8566, 2.3522];

  return (
    <div className="flex flex-col h-[calc(100dvh-64px)]">
      <div className="flex gap-1 p-2 bg-[#0a0a0a]">
        <button
          onClick={() => setTab('history')}
          className={`flex-1 py-2 rounded-lg text-sm font-medium min-h-[44px] transition-colors duration-150 ${
            tab === 'history' ? 'bg-[#e31937] text-white' : 'bg-[#1a1a1a] text-[#9ca3af]'
          }`}
        >
          History
        </button>
        <button
          onClick={() => setTab('waze')}
          className={`flex-1 py-2 rounded-lg text-sm font-medium min-h-[44px] transition-colors duration-150 ${
            tab === 'waze' ? 'bg-[#e31937] text-white' : 'bg-[#1a1a1a] text-[#9ca3af]'
          }`}
        >
          Waze Traffic
        </button>
      </div>

      <div className="flex-1">
        {tab === 'history' ? (
          <LeafletMap
            routePoints={routePoints}
            chargeMarkers={chargeMarkers}
            positions={positions}
            center={defaultCenter}
          />
        ) : (
          <WazeEmbed
            lat={gpsPosition?.lat ?? defaultCenter[0]}
            lng={gpsPosition?.lng ?? defaultCenter[1]}
          />
        )}
      </div>
    </div>
  );
}
