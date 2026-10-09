/**
 * Presentation-only layer registry for the Cesium map front.
 * Does not own dataset authority, schema, or spatial query semantics.
 */

import { CESIUM_EVIDENCE_LAYERS, type CesiumEvidenceLayerKey } from './types';

export type MapfrontLayerKind =
  | 'evidence'
  | 'property'
  | 'buildings'
  | 'terrain'
  | 'orthophoto'
  | 'topographic'
  | 'land_cover'
  | 'topography'
  | 'hydrography';

export type MapfrontPresentationFormat =
  | 'geojson_entities'
  | '3d_tiles'
  | 'terrain_tiles'
  | 'imagery_tiles'
  | 'registration_seam_only';

export type MapfrontLayerRegistration = {
  readonly layer_id: string;
  readonly kind: MapfrontLayerKind;
  readonly labelSv: string;
  readonly presentation: MapfrontPresentationFormat;
  readonly admit_layer_id: string | null;
  readonly client_status: 'READY' | 'SEAM_ONLY' | 'AWAITING_GOVERNED_PRODUCT';
  readonly defaultVisible: boolean;
  readonly notes?: string;
};

const EVIDENCE_ADMIT: Record<CesiumEvidenceLayerKey, string | null> = {
  water: 'lu.water_wells',
  ebh: 'lu.ebh',
  protected_area: 'lu.protected_area',
  natura2000: 'lu.natura2000',
  water_protection_area: 'lu.water_protection_area',
};

export const MAPFRONT_LAYER_REGISTRY: readonly MapfrontLayerRegistration[] = [
  ...CESIUM_EVIDENCE_LAYERS.map(
    (layer): MapfrontLayerRegistration => ({
      layer_id: layer.key,
      kind: 'evidence',
      labelSv: layer.label,
      presentation: 'geojson_entities',
      admit_layer_id: EVIDENCE_ADMIT[layer.key],
      client_status: 'READY',
      defaultVisible: true,
    }),
  ),
  {
    layer_id: 'property',
    kind: 'property',
    labelSv: 'Fastighet',
    presentation: 'geojson_entities',
    admit_layer_id: null,
    client_status: 'READY',
    defaultVisible: true,
    notes: 'Viewport-bounded read-model GeoJSON; national scale uses 3D Tiles product later.',
  },
  {
    layer_id: 'buildings',
    kind: 'buildings',
    labelSv: 'Byggnader',
    presentation: '3d_tiles',
    admit_layer_id: null,
    client_status: 'READY',
    defaultVisible: false,
    notes: 'BUILDING CLIENT COMPLETE / REAL NATIONAL DATA PENDING — local tileset fixture proves path.',
  },
  {
    layer_id: 'terrain',
    kind: 'terrain',
    labelSv: 'Terräng',
    presentation: 'terrain_tiles',
    admit_layer_id: null,
    client_status: 'READY',
    defaultVisible: false,
    notes: 'Ellipsoid fallback + local governed provider seam.',
  },
  {
    layer_id: 'orthophoto',
    kind: 'orthophoto',
    labelSv: 'Ortofoto',
    presentation: 'imagery_tiles',
    admit_layer_id: null,
    client_status: 'READY',
    defaultVisible: false,
  },
  {
    layer_id: 'topographic',
    kind: 'topographic',
    labelSv: 'Topografisk karta',
    presentation: 'imagery_tiles',
    admit_layer_id: null,
    client_status: 'READY',
    defaultVisible: false,
  },
  {
    layer_id: 'land_cover',
    kind: 'land_cover',
    labelSv: 'Marktäcke',
    presentation: 'registration_seam_only',
    admit_layer_id: null,
    client_status: 'SEAM_ONLY',
    defaultVisible: false,
  },
  {
    layer_id: 'topography_vectors',
    kind: 'topography',
    labelSv: 'Topografi (vektor)',
    presentation: 'registration_seam_only',
    admit_layer_id: null,
    client_status: 'SEAM_ONLY',
    defaultVisible: false,
  },
  {
    layer_id: 'hydrography',
    kind: 'hydrography',
    labelSv: 'Hydrografi',
    presentation: 'registration_seam_only',
    admit_layer_id: null,
    client_status: 'SEAM_ONLY',
    defaultVisible: false,
  },
];

export function getMapfrontLayer(layerId: string): MapfrontLayerRegistration | undefined {
  return MAPFRONT_LAYER_REGISTRY.find((layer) => layer.layer_id === layerId);
}
