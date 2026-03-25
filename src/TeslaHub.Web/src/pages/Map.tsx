import { useState, useMemo } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { getRecentPositions, getPositionsInRange, getChargingSessions, getDrivePositions } from '../api/queries';
import LeafletMap from '../components/LeafletMap';

interface Props {
  carId: number | undefined;
}

type RangeKey = '24h' | '48h' | '7d' | '30d' | 'custom';

const RANGE_OPTIONS: { key: RangeKey; label: string; hours?: number }[] = [
  { key: '24h', label: '24h', hours: 24 },
  { key: '48h', label: '48h', hours: 48 },
  { key: '7d', label: '7 days', hours: 168 },
  { key: '30d', label: '30 days', hours: 720 },
  { key: 'custom', label: 'Custom' },
];

function formatDateForInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function MapPage({ carId }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const driveIdParam = searchParams.get('driveId');
  const driveId = driveIdParam ? parseInt(driveIdParam, 10) : null;
  const latParam = searchParams.get('lat');
  const lngParam = searchParams.get('lng');
  const positionMode = latParam != null && lngParam != null;
  const posLat = positionMode ? parseFloat(latParam) : null;
  const posLng = positionMode ? parseFloat(lngParam) : null;

  const [rangeKey, setRangeKey] = useState<RangeKey>('48h');
  const [customFrom, setCustomFrom] = useState(() => formatDateForInput(new Date(Date.now() - 48 * 3600_000)));
  const [customTo, setCustomTo] = useState(() => formatDateForInput(new Date()));

  const selectedRange = RANGE_OPTIONS.find((r) => r.key === rangeKey)!;

  // Single drive mode
  const { data: drivePositions } = useQuery({
    queryKey: ['drivePositions', driveId],
    queryFn: () => getDrivePositions(driveId!),
    enabled: driveId != null && !positionMode,
    placeholderData: keepPreviousData,
  });

  // Range mode
  const { data: rangePositions } = useQuery({
    queryKey: rangeKey === 'custom'
      ? ['mapPositions', carId, 'custom', customFrom, customTo]
      : ['mapPositions', carId, rangeKey],
    queryFn: () => {
      if (!carId) return Promise.resolve([]);
      if (rangeKey === 'custom') {
        return getPositionsInRange(carId, new Date(customFrom).toISOString(), new Date(customTo).toISOString());
      }
      return getRecentPositions(carId, selectedRange.hours!);
    },
    enabled: !!carId && driveId == null && !positionMode,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });

  const { data: charges } = useQuery({
    queryKey: ['chargingForMap', carId],
    queryFn: () => getChargingSessions(carId!, 20),
    enabled: !!carId && driveId == null && !positionMode,
    placeholderData: keepPreviousData,
  });

  const positions = driveId != null ? drivePositions : rangePositions;

  const routePoints = useMemo(
    () => positions?.map((p) => [p.latitude, p.longitude] as [number, number]) ?? [],
    [positions]
  );

  const chargeMarkers = useMemo(
    () => driveId != null ? [] : (charges?.filter((c) => c.endDate && c.latitude != null && c.longitude != null)?.slice(0, 20) ?? []),
    [charges, driveId]
  );

  const clearParams = () => {
    setSearchParams({});
  };

  const positionPoint: [number, number][] = posLat != null && posLng != null ? [[posLat, posLng]] : [];

  return (
    <div className="flex flex-col h-[calc(100dvh-64px)]">
      {positionMode ? (
        <div className="flex items-center gap-2 p-2 bg-[#0a0a0a]">
          <button
            onClick={clearParams}
            className="px-3 py-2 rounded-lg text-sm font-medium min-h-[40px] bg-[#1a1a1a] text-[#9ca3af] active:bg-[#2a2a2a]"
          >
            ← Back
          </button>
          <span className="text-sm text-white font-medium">Current position</span>
        </div>
      ) : driveId != null ? (
        <div className="flex items-center gap-2 p-2 bg-[#0a0a0a]">
          <button
            onClick={clearParams}
            className="px-3 py-2 rounded-lg text-sm font-medium min-h-[40px] bg-[#1a1a1a] text-[#9ca3af] active:bg-[#2a2a2a]"
          >
            ← Back
          </button>
          <span className="text-sm text-white font-medium">Trip #{driveId}</span>
          <span className="text-xs text-[#9ca3af] ml-auto">{routePoints.length} points</span>
        </div>
      ) : (
        <>
          {/* Range selector */}
          <div className="flex gap-1 p-2 bg-[#0a0a0a] flex-wrap">
            {RANGE_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                onClick={() => setRangeKey(opt.key)}
                className={`px-3 py-2 rounded-lg text-sm font-medium min-h-[40px] transition-colors duration-150 ${
                  rangeKey === opt.key ? 'bg-[#e31937] text-white' : 'bg-[#1a1a1a] text-[#9ca3af]'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Custom date inputs */}
          {rangeKey === 'custom' && (
            <div className="flex gap-2 px-2 pb-2 bg-[#0a0a0a]">
              <input
                type="datetime-local"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="flex-1 bg-[#141414] border border-[#2a2a2a] rounded-lg px-2 py-1.5 text-white text-xs focus:border-[#e31937] focus:outline-none min-h-[40px]"
              />
              <input
                type="datetime-local"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="flex-1 bg-[#141414] border border-[#2a2a2a] rounded-lg px-2 py-1.5 text-white text-xs focus:border-[#e31937] focus:outline-none min-h-[40px]"
              />
            </div>
          )}

          {/* Info bar */}
          <div className="flex items-center justify-between px-3 py-1.5 bg-[#141414] border-b border-[#2a2a2a] text-xs text-[#9ca3af]">
            <span>{routePoints.length > 0 ? `${routePoints.length} points` : 'No data'}</span>
            <span>{chargeMarkers.length} charges</span>
          </div>
        </>
      )}

      {/* Map */}
      <div className="flex-1">
        <LeafletMap
          routePoints={positionMode ? positionPoint : routePoints}
          chargeMarkers={positionMode ? [] : chargeMarkers}
        />
      </div>
    </div>
  );
}
