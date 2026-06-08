import { useEffect } from 'react';
import L from 'leaflet';
import 'leaflet.vectorgrid';
import { MapContainer, TileLayer, WMSTileLayer, useMap } from 'react-leaflet';

type ProjectMapProps = {
  center?: [number, number];
  zoom?: number;
  className?: string;
  showNmdLayer?: boolean;
};

const DEFAULT_CENTER: [number, number] = [59.3293, 18.0686];
const DEFAULT_ZOOM = 12;
const OSM_ATTRIBUTION = '&copy; OpenStreetMap-bidragsgivare';

function getNmdColor(code: number): string {
  if (code >= 111 && code <= 128) return '#166534';
  if (code === 3) return '#ca8a04';
  if (code === 61 || code === 62) return '#2563eb';
  if (code >= 200 && code <= 230) return '#0f766e';
  if (code >= 51 && code <= 54) return '#6b7280';
  return '#7c3aed';
}

function getLantmaterietWmsUrl(): string | null {
  const key = String(import.meta.env.VITE_LANTMATERIET_OPEN_SUBSCRIPTION_KEY ?? '').trim();
  if (!key) {
    return null;
  }

  return `https://api.lantmateriet.se/open/topowebb-ccby/v1/wms?subscription-key=${encodeURIComponent(key)}`;
}

function NmdVectorTileLayer({ visible }: { visible: boolean }) {
  const map = useMap();

  useEffect(() => {
    if (!visible) {
      return undefined;
    }

    const layer = (L as typeof L & { vectorGrid: typeof import('leaflet.vectorgrid').vectorGrid }).vectorGrid.protobuf(
      '/api/tiles/nmd/{z}/{x}/{y}.pbf',
      {
        interactive: true,
        vectorTileLayerStyles: {
          nmd: (properties) => {
            const code = Number(properties.nmd_code ?? 0);
            const fillColor = getNmdColor(code);

            return {
              color: fillColor,
              fillColor,
              fillOpacity: 0.35,
              opacity: 0.85,
              weight: 0.6,
            };
          },
        },
      },
    );

    layer.addTo(map);
    return () => {
      map.removeLayer(layer);
    };
  }, [map, visible]);

  return null;
}

export function ProjectMap({
  center = DEFAULT_CENTER,
  zoom = DEFAULT_ZOOM,
  className = '',
  showNmdLayer = true,
}: ProjectMapProps) {
  const lantmaterietUrl = getLantmaterietWmsUrl();

  return (
    <div className={`overflow-hidden rounded-2xl border border-white/10 bg-[var(--bg-card)] shadow-lg ${className}`}>
      <MapContainer center={center} zoom={zoom} scrollWheelZoom className="h-[480px] w-full">
        {lantmaterietUrl ? (
          <WMSTileLayer
            url={lantmaterietUrl}
            layers="topowebb"
            format="image/png"
            transparent={false}
            version="1.3.0"
          />
        ) : (
          <TileLayer attribution={OSM_ATTRIBUTION} url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        )}
        <NmdVectorTileLayer visible={showNmdLayer} />
      </MapContainer>
    </div>
  );
}

export default ProjectMap;
