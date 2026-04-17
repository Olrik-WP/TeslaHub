import { useQuery } from '@tanstack/react-query';
import { getSettings } from '../api/queries';

export interface MapStyleDef {
  label: string;
  labelKey: string;
  url: string;
  pitch?: number;
  bearing?: number;
  is3D?: boolean;
}

export const MAP_STYLES: Record<string, MapStyleDef> = {
  positron: {
    label: 'Positron',
    labelKey: 'settings.mapPositron',
    url: 'https://tiles.openfreemap.org/styles/positron',
  },
  bright: {
    label: 'Bright',
    labelKey: 'settings.mapBright',
    url: 'https://tiles.openfreemap.org/styles/bright',
  },
  liberty: {
    label: 'Liberty',
    labelKey: 'settings.mapLiberty',
    url: 'https://tiles.openfreemap.org/styles/liberty',
  },
  liberty3d: {
    label: '3D',
    labelKey: 'settings.map3D',
    url: 'https://tiles.openfreemap.org/styles/liberty',
    pitch: 60,
    bearing: -17,
    is3D: true,
  },
};

const TERRAIN_SOURCE = {
  type: 'raster-dem' as const,
  tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
  encoding: 'terrarium' as const,
  tileSize: 256,
  maxzoom: 15,
};

export function useMapStyle() {
  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: getSettings,
    staleTime: 5 * 60_000,
  });

  const key = settings?.mapStyle ?? 'liberty';
  const style = MAP_STYLES[key] ?? MAP_STYLES.liberty;

  return {
    styleUrl: style.url,
    pitch: style.pitch ?? 0,
    bearing: style.bearing ?? 0,
    is3D: style.is3D ?? false,
    styleKey: key,
  };
}

export function setup3D(map: maplibregl.Map) {
  if (map.getSource('terrainSource')) return;

  map.addSource('terrainSource', TERRAIN_SOURCE);
  map.setTerrain({ source: 'terrainSource', exaggeration: 1 });

  if (!map.getLayer('3d-buildings')) {
    const layers = map.getStyle().layers ?? [];
    let labelLayerId: string | undefined;
    for (const layer of layers) {
      if (layer.type === 'symbol' && (layer.layout as Record<string, unknown>)?.['text-field']) {
        labelLayerId = layer.id;
        break;
      }
    }

    map.addLayer(
      {
        id: '3d-buildings',
        source: 'openmaptiles',
        'source-layer': 'building',
        type: 'fill-extrusion',
        minzoom: 14,
        paint: {
          'fill-extrusion-color': '#aaa',
          'fill-extrusion-height': ['get', 'render_height'],
          'fill-extrusion-base': ['get', 'render_min_height'],
          'fill-extrusion-opacity': 0.6,
        },
      },
      labelLayerId,
    );
  }
}
