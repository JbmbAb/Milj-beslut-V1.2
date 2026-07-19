/**
 * Ett kartlager per plattformsdatakälla (platform-datasources) + lokala filer.
 * Endpoint: GET /api/layers/dataset/:layerKey?bbox=...
 */

import { PLATFORM_COLLECTIONS } from '../../scripts/import/platform-datasources';
import { LASTKAJEN_MAP_LAYERS } from './lastkajenLayerCatalog';

export type DatasetLayerGeometry = 'polygon' | 'line' | 'point' | 'mixed';

export type DatasetLayerStyle =
  | 'default_polygon'
  | 'default_line'
  | 'default_point'
  | 'water'
  | 'nature'
  | 'heritage'
  | 'geology'
  | 'property'
  | 'species';

export interface PlatformDatasetMapLayer {
  key: string;
  label: string;
  schema: string;
  table: string;
  geometry: DatasetLayerGeometry;
  bboxRequired: boolean;
  provider: string;
  style: DatasetLayerStyle;
  /** Min zoom för tunga lager (valfritt) */
  minZoom?: number;
}

function parseTableRef(tableRef: string): { schema: string; table: string } {
  const [schema, table] = tableRef.split('.');
  if (!schema || !table) {
    throw new Error(`Invalid table reference: ${tableRef}`);
  }
  return { schema, table };
}

const PLATFORM_LABELS: Record<
  string,
  { label: string; geometry: DatasetLayerGeometry; style: DatasetLayerStyle; minZoom?: number }
> = {
  sgu_ground_1m: { label: 'SGU grundlager 1M', geometry: 'polygon', style: 'geology' },
  sgu_landslide: { label: 'SGU jordskred/raviner', geometry: 'line', style: 'geology' },
  sgu_soil_25k_100k: { label: 'SGU jordarter 25k–100k', geometry: 'polygon', style: 'geology' },
  sgu_groundwater: { label: 'SGU grundvatten sårbarhet', geometry: 'polygon', style: 'water' },
  sgu_wells: { label: 'SGU brunnar', geometry: 'point', style: 'default_point' },
  sgu_aktsam_efterarbetad: { label: 'SGU åtgärd efterarbetad', geometry: 'polygon', style: 'geology' },
  sgu_erosion_aktiv: { label: 'SGU aktiv kusterosion', geometry: 'polygon', style: 'geology' },
  sgu_fastmark: { label: 'SGU fastmark stabilitet', geometry: 'polygon', style: 'geology', minZoom: 9 },
  lm_fastighetsytor: { label: 'Fastighetsytor (LM)', geometry: 'polygon', style: 'property', minZoom: 11 },
  lm_fastighetslinjer: { label: 'Fastighetslinjer (LM)', geometry: 'line', style: 'property', minZoom: 12 },
  lm_topo_mark: { label: 'LM topografi mark', geometry: 'polygon', style: 'default_polygon', minZoom: 10 },
  lm_topo_byggnad: {
    label: 'LM topografi byggnad',
    geometry: 'polygon',
    style: 'default_polygon',
    minZoom: 12,
  },
  lm_topo_vatten: { label: 'LM topografi vatten', geometry: 'polygon', style: 'water', minZoom: 10 },
  nv_skyddad_natur: { label: 'NV skyddad natur (OGC)', geometry: 'polygon', style: 'nature' },
  raa_fornlamningar: { label: 'Fornlämningar (PostGIS)', geometry: 'mixed', style: 'heritage', minZoom: 10 },
  lst_vattenskydd: { label: 'LST vattenskyddsområden', geometry: 'polygon', style: 'water' },
  lst_miljofarlig_verksamhet: {
    label: 'LST miljöfarlig verksamhet',
    geometry: 'point',
    style: 'default_point',
  },
  viss_vattenforekomster: { label: 'VISS vattenförekomster', geometry: 'polygon', style: 'water' },
  smed_belastning_vatten: { label: 'SMED belastning vatten', geometry: 'polygon', style: 'water' },
  smed_utslapp_luft: { label: 'SMED utsläpp luft 1km', geometry: 'polygon', style: 'default_polygon' },
  smhi_huvudavrinningsomraden: { label: 'SMHI huvudavrinningsområden', geometry: 'polygon', style: 'water' },
  slu_artobservationer: { label: 'SLU artobservationer', geometry: 'point', style: 'species', minZoom: 11 },
  skogsstyrelsen_nyckelbiotoper: {
    label: 'Skogsstyrelsen nyckelbiotoper',
    geometry: 'polygon',
    style: 'nature',
  },
  skogsstyrelsen_naturvarden: { label: 'Skogsstyrelsen naturvärden', geometry: 'polygon', style: 'nature' },
};

function providerFromId(id: string): string {
  if (id.startsWith('sgu_')) return 'SGU';
  if (id.startsWith('lm_')) return 'Lantmäteriet';
  if (id.startsWith('nv_')) return 'Naturvårdsverket';
  if (id.startsWith('raa_')) return 'Riksantikvarieämbetet';
  if (id.startsWith('lst_')) return 'Länsstyrelsen';
  if (id.startsWith('viss_') || id.startsWith('smed_')) return 'SMED/VISS';
  if (id.startsWith('smhi_')) return 'SMHI';
  if (id.startsWith('slu_')) return 'SLU';
  if (id.startsWith('skogsstyrelsen_')) return 'Skogsstyrelsen';
  return 'PostGIS';
}

export const PLATFORM_DATASET_MAP_LAYERS: PlatformDatasetMapLayer[] = PLATFORM_COLLECTIONS.map((item) => {
  const { schema, table } = parseTableRef(item.table);
  const meta = PLATFORM_LABELS[item.id] ?? {
    label: item.id,
    geometry: 'mixed' as DatasetLayerGeometry,
    style: 'default_polygon' as DatasetLayerStyle,
  };
  return {
    key: item.id,
    label: meta.label,
    schema,
    table,
    geometry: meta.geometry,
    bboxRequired: true,
    provider: providerFromId(item.id),
    style: meta.style,
    minZoom: meta.minZoom,
  };
});

/** RAA INSPRE Buildings – ruiner (BU.Ruins.gml) */
export const RAA_BUILDING_RUIN_LAYER: PlatformDatasetMapLayer = {
  key: 'raa_building_ruin',
  label: 'Byggnadsruiner (RAA)',
  schema: 'env',
  table: 'raa_building_ruin',
  geometry: 'point',
  bboxRequired: true,
  provider: 'Riksantikvarieämbetet',
  style: 'heritage',
  minZoom: 10,
};

/** SLU – avrinningsområden kring nationellt övervakade sjöar (SLS + trend) */
export const SLU_LAKE_CATCHMENT_LAYER: PlatformDatasetMapLayer = {
  key: 'slu_lake_catchment',
  label: 'SLU sjöavrinningsområden',
  schema: 'hydro',
  table: 'slu_lake_catchment',
  geometry: 'polygon',
  bboxRequired: true,
  provider: 'SLU',
  style: 'water',
  minZoom: 9,
};

export const ALL_DATASET_MAP_LAYERS: PlatformDatasetMapLayer[] = [
  ...PLATFORM_DATASET_MAP_LAYERS,
  RAA_BUILDING_RUIN_LAYER,
  SLU_LAKE_CATCHMENT_LAYER,
  ...LASTKAJEN_MAP_LAYERS,
];

const layerByKey = new Map(ALL_DATASET_MAP_LAYERS.map((l) => [l.key, l]));

export function findDatasetMapLayer(key: string): PlatformDatasetMapLayer | undefined {
  return layerByKey.get(key);
}

export function listDatasetMapLayerKeys(): string[] {
  return ALL_DATASET_MAP_LAYERS.map((l) => l.key);
}
