import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet';
import { useTranslation } from 'react-i18next';
import { getLocationStats, getVisitedLocations, getTopCities, getSettings } from '../api/queries';
import StatCard from '../components/StatCard';
import { utcDate } from '../utils/date';

interface Props {
  carId: number | undefined;
}

type Tab = 'map' | 'list';

export default function Locations({ carId }: Props) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('map');
  const [search, setSearch] = useState('');

  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: getSettings });
  const mapTile = settings?.mapTileUrl ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

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

  if (statsLoading || locsLoading) {
    return <div className="flex items-center justify-center h-[60vh] text-[#9ca3af]">{t('app.loading')}</div>;
  }

  const filtered = locations?.filter((l) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      l.address.toLowerCase().includes(q) ||
      l.city?.toLowerCase().includes(q) ||
      l.state?.toLowerCase().includes(q) ||
      l.country?.toLowerCase().includes(q)
    );
  }) ?? [];

  const mappable = filtered.filter((l) => l.latitude != null && l.longitude != null);
  const maxVisits = Math.max(...(mappable.map((l) => l.visitCount) || [1]), 1);

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-lg sm:text-xl font-bold text-white">{t('locationsPage.title')}</h1>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label={t('locationsPage.addresses')} value={stats.addressCount} color="#3b82f6" />
          <StatCard label={t('locationsPage.cities')} value={stats.cityCount} color="#22c55e" />
          <StatCard label={t('locationsPage.states')} value={stats.stateCount} color="#f59e0b" />
          <StatCard label={t('locationsPage.countries')} value={stats.countryCount} color="#a855f7" />
        </div>
      )}

      {/* Top cities bar */}
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

      {/* Tabs + search */}
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

      {/* Map */}
      {tab === 'map' && mappable.length > 0 && (
        <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl overflow-hidden" style={{ height: 450 }}>
          <MapContainer
            center={[mappable[0].latitude!, mappable[0].longitude!]}
            zoom={6}
            className="w-full h-full"
            zoomControl={true}
            attributionControl={false}
          >
            <TileLayer url={mapTile} maxZoom={19} className="dark-map-tiles" />
            {mappable.map((loc, i) => {
              const radius = 4 + (loc.visitCount / maxVisits) * 12;
              return (
                <CircleMarker
                  key={i}
                  center={[loc.latitude!, loc.longitude!]}
                  radius={radius}
                  fillColor="#e31937"
                  fillOpacity={0.7}
                  color="#fff"
                  weight={1}
                >
                  <Popup>
                    <div className="text-xs">
                      <div className="font-bold">{loc.address}</div>
                      {loc.city && <div>{loc.city}</div>}
                      <div>{loc.visitCount} {t('locationsPage.visits')}</div>
                      <div className="text-gray-500">{utcDate(loc.lastVisited).toLocaleDateString()}</div>
                    </div>
                  </Popup>
                </CircleMarker>
              );
            })}
          </MapContainer>
        </div>
      )}

      {/* List */}
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
