import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Map, Source, Layer, Popup } from 'react-map-gl/maplibre';
import { useTranslation } from 'react-i18next';
import { getLocationStats, getVisitedLocations, getTopCities } from '../api/queries';
import { useMapStyle } from '../hooks/useMapStyle';
import StatCard from '../components/StatCard';
import { utcDate } from '../utils/date';
import 'maplibre-gl/dist/maplibre-gl.css';

interface Props {
  carId: number | undefined;
}

type Tab = 'map' | 'list';

export default function Locations({ carId }: Props) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('map');
  const [search, setSearch] = useState('');
  const { styleUrl } = useMapStyle();

  const [popupInfo, setPopupInfo] = useState<{
    longitude: number; latitude: number;
    address: string; city?: string | null;
    visitCount: number; lastVisited: string;
  } | null>(null);

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['locationStats', carId],
    queryFn: () => getLocationStats(carId!),
    enabled: !!carId,
    staleTime: 5 * 60_000,
  });

  const { data: locations, isLoading: locsLoading } = useQuery({
    queryKey: ['visitedLocations', carId],
    queryFn: () => getVisitedLocations(carId!),
    enabled: !!carId,
    staleTime: 5 * 60_000,
  });

  const { data: topCities } = useQuery({
    queryKey: ['topCities', carId],
    queryFn: () => getTopCities(carId!),
    enabled: !!carId,
    staleTime: 5 * 60_000,
  });

  const filtered = useMemo(() => {
    return locations?.filter((l) => {
      if (!search) return true;
      const q = search.toLowerCase();
      return (
        l.address.toLowerCase().includes(q) ||
        l.city?.toLowerCase().includes(q) ||
        l.state?.toLowerCase().includes(q) ||
        l.country?.toLowerCase().includes(q)
      );
    }) ?? [];
  }, [locations, search]);

  const mappable = useMemo(
    () => filtered.filter((l) => l.latitude != null && l.longitude != null),
    [filtered]
  );

  const maxVisits = useMemo(
    () => mappable.reduce((m, l) => Math.max(m, l.visitCount), 1),
    [mappable]
  );

  const geojson = useMemo(() => ({
    type: 'FeatureCollection' as const,
    features: mappable.map((loc) => ({
      type: 'Feature' as const,
      properties: {
        address: loc.address,
        city: loc.city ?? '',
        visitCount: loc.visitCount,
        lastVisited: loc.lastVisited,
        radius: 4 + (loc.visitCount / maxVisits) * 12,
      },
      geometry: {
        type: 'Point' as const,
        coordinates: [loc.longitude!, loc.latitude!],
      },
    })),
  }), [mappable, maxVisits]);

  const center = mappable.length > 0
    ? { longitude: mappable[0].longitude!, latitude: mappable[0].latitude! }
    : { longitude: 2.3522, latitude: 48.8566 };

  if (statsLoading || locsLoading) {
    return <div className="flex items-center justify-center h-[60vh] text-[#9ca3af]">{t('app.loading')}</div>;
  }

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-lg sm:text-xl font-bold text-white">{t('locationsPage.title')}</h1>

      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label={t('locationsPage.addresses')} value={stats.addressCount} color="#3b82f6" />
          <StatCard label={t('locationsPage.cities')} value={stats.cityCount} color="#22c55e" />
          <StatCard label={t('locationsPage.states')} value={stats.stateCount} color="#f59e0b" />
          <StatCard label={t('locationsPage.countries')} value={stats.countryCount} color="#a855f7" />
        </div>
      )}

      {topCities && topCities.length > 0 && (
        <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl p-3 sm:p-4">
          <div className="text-xs text-[#9ca3af] uppercase tracking-wider mb-3">{t('locationsPage.topCities')}</div>
          <div className="space-y-1.5">
            {topCities.map((c) => {
              const pct = Math.max(5, (c.count / topCities[0].count) * 100);
              return (
                <div key={c.city} className="flex items-center gap-2 text-xs">
                  <span className="w-24 sm:w-32 truncate text-[#d1d5db]">{c.city}</span>
                  <div className="flex-1 h-4 bg-[#1a1a1a] rounded overflow-hidden">
                    <div
                      className="h-full bg-[#22c55e]/60 rounded"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-[#9ca3af] w-8 text-right tabular-nums">{c.count}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        {(['map', 'list'] as const).map((t2) => (
          <button
            key={t2}
            onClick={() => setTab(t2)}
            className={`px-3 py-2 rounded-lg text-sm font-medium min-h-[40px] transition-colors ${
              tab === t2 ? 'bg-[#e31937] text-white' : 'bg-[#1a1a1a] text-[#9ca3af]'
            }`}
          >
            {t2 === 'map' ? t('locationsPage.map') : t('locationsPage.list')}
          </button>
        ))}
        <input
          className="flex-1 min-w-[140px] bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-white text-sm focus:border-[#e31937] focus:outline-none min-h-[40px]"
          placeholder={t('locationsPage.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {tab === 'map' && mappable.length > 0 && (
        <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl overflow-hidden" style={{ height: 450 }}>
          <Map
            initialViewState={{ ...center, zoom: 6 }}
            mapStyle={styleUrl}
            attributionControl={false}
            style={{ width: '100%', height: '100%' }}
            interactiveLayerIds={['location-circles']}
            onClick={(e) => {
              const feat = e.features?.[0];
              if (feat && feat.geometry.type === 'Point') {
                const [lng, lat] = feat.geometry.coordinates;
                setPopupInfo({
                  longitude: lng, latitude: lat,
                  address: feat.properties?.address ?? '',
                  city: feat.properties?.city || null,
                  visitCount: feat.properties?.visitCount ?? 0,
                  lastVisited: feat.properties?.lastVisited ?? '',
                });
              }
            }}
          >
            <Source id="locations" type="geojson" data={geojson}>
              <Layer
                id="location-circles"
                type="circle"
                paint={{
                  'circle-radius': ['get', 'radius'],
                  'circle-color': '#e31937',
                  'circle-opacity': 0.7,
                  'circle-stroke-color': '#fff',
                  'circle-stroke-width': 1,
                }}
              />
            </Source>

            {popupInfo && (
              <Popup
                longitude={popupInfo.longitude}
                latitude={popupInfo.latitude}
                anchor="bottom"
                onClose={() => setPopupInfo(null)}
                closeOnClick={false}
                className="text-black"
              >
                <div className="text-xs">
                  <div className="font-bold">{popupInfo.address}</div>
                  {popupInfo.city && <div>{popupInfo.city}</div>}
                  <div>{popupInfo.visitCount} {t('locationsPage.visits')}</div>
                  <div className="text-gray-500">{utcDate(popupInfo.lastVisited).toLocaleDateString()}</div>
                </div>
              </Popup>
            )}
          </Map>
        </div>
      )}

      {tab === 'list' && (
        <div className="space-y-2">
          {filtered.length === 0 && (
            <div className="text-center text-[#9ca3af] py-8">{t('locationsPage.noResults')}</div>
          )}
          {filtered.map((loc, i) => (
            <div key={i} className="bg-[#141414] border border-[#2a2a2a] rounded-xl p-3 sm:p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-white truncate">{loc.address}</div>
                  <div className="text-xs text-[#9ca3af] mt-0.5">
                    {[loc.city, loc.state, loc.country].filter(Boolean).join(', ')}
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="text-sm font-bold text-[#e31937] tabular-nums">{loc.visitCount}</div>
                  <div className="text-[10px] text-[#9ca3af]">{t('locationsPage.visits')}</div>
                </div>
              </div>
              <div className="text-[10px] text-[#6b7280] mt-1">
                {t('locationsPage.lastVisit')}: {utcDate(loc.lastVisited).toLocaleDateString()}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'map' && mappable.length === 0 && (
        <div className="text-center text-[#9ca3af] py-8">{t('locationsPage.noResults')}</div>
      )}
    </div>
  );
}
