import { useEffect, useState } from 'react';
import L from 'leaflet';
import 'leaflet.vectorgrid';
import { MapContainer, useMap } from 'react-leaflet';

type ProjectMapProps = {
  center?: [number, number];
  zoom?: number;
  className?: string;
};

const DEFAULT_CENTER: [number, number] = [59.3293, 18.0686];
const DEFAULT_ZOOM = 12;

interface LayerMetadata {
  id: string;
  minZoom: number;
  maxZoom: number;
  style: any;
}

function DynamicVectorTileLayers({ layers }: { layers: LayerMetadata[] }) {
  const map = useMap();

  useEffect(() => {
    if (!layers || layers.length === 0) return;

    const addedLayers: any[] = [];

    // Order matters, usually you want fastighet (property) below byggnad (building).
    // The server metadata API returns an array which we could sort if needed.
    layers.forEach((layerMeta) => {
      const { id, style } = layerMeta;

      const layer = (L as typeof L & { vectorGrid: typeof import('leaflet.vectorgrid').vectorGrid }).vectorGrid.protobuf(
        `/api/tiles/${id}/{z}/{x}/{y}.pbf`,
        {
          interactive: true,
          vectorTileLayerStyles: {
            // Leaflet vectorGrid maps the vector style to the layer name 
            // from the MVT. In our SQL, we named it 'geom' (the default) or 'tile'.
            // Actually ST_AsMVT uses 'default' if not specified, but we used 'geom'.
            geom: () => style,
          },
        },
      );

      layer.addTo(map);
      addedLayers.push(layer);
    });

    return () => {
      addedLayers.forEach(l => map.removeLayer(l));
    };
  }, [map, layers]);

  return null;
}

export function ProjectMap({
  center = DEFAULT_CENTER,
  zoom = DEFAULT_ZOOM,
  className = '',
}: ProjectMapProps) {
  const [layers, setLayers] = useState<LayerMetadata[]>([]);

  useEffect(() => {
    // Fetch layer metadata from our generic endpoint
    fetch('/api/tiles/metadata')
      .then(res => res.json())
      .then(data => setLayers(data))
      .catch(err => console.error('Failed to load tile metadata:', err));
  }, []);

  return (
    <div className={`overflow-hidden rounded-2xl border border-white/10 shadow-lg ${className}`} style={{ backgroundColor: '#F2F3F5' }}>
      {/* @ts-ignore */}
      <MapContainer center={center} zoom={zoom} scrollWheelZoom className="h-[480px] w-full bg-transparent">
        <DynamicVectorTileLayers layers={layers} />
      </MapContainer>
    </div>
  );
}

export default ProjectMap;
