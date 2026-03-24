import { useGeoLocation } from '../hooks/useGeoLocation';

interface Props {
  lat?: number | null;
  lng?: number | null;
}

export default function WazeEmbed({ lat, lng }: Props) {
  const { position } = useGeoLocation();

  const useLat = lat ?? position?.lat;
  const useLng = lng ?? position?.lng;

  const wazeUrl =
    useLat != null && useLng != null
      ? `https://www.waze.com/live-map/directions?to=ll.${useLat}%2C${useLng}`
      : 'https://www.waze.com/live-map/';

  const wazeNavUrl =
    useLat != null && useLng != null
      ? `https://waze.com/ul?ll=${useLat},${useLng}&navigate=yes`
      : 'https://waze.com/ul';

  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 p-6 bg-[#0a0a0a]">
      <div className="text-center">
        <div className="text-5xl mb-4">🗺️</div>
        <h2 className="text-xl font-semibold text-white mb-2">Waze Live Traffic</h2>
        <p className="text-sm text-[#9ca3af] max-w-xs">
          Waze ne supporte pas l'affichage integre. Ouvrez dans un nouvel onglet.
        </p>
      </div>

      <a
        href={wazeUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="w-full max-w-xs bg-[#33ccff] text-black px-6 py-4 rounded-xl text-base font-semibold min-h-[56px] flex items-center justify-center gap-2 transition-opacity active:opacity-80"
      >
        Voir le trafic en direct
      </a>

      <a
        href={wazeNavUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="w-full max-w-xs bg-[#1a1a1a] text-white border border-[#2a2a2a] px-6 py-4 rounded-xl text-base font-semibold min-h-[56px] flex items-center justify-center gap-2 transition-opacity active:opacity-80"
      >
        Naviguer avec Waze
      </a>

      {useLat != null && useLng != null && (
        <p className="text-xs text-[#6b7280]">
          Position : {useLat.toFixed(4)}, {useLng.toFixed(4)}
        </p>
      )}
    </div>
  );
}
