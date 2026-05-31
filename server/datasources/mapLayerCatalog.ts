/**
 * mapLayerCatalog.ts
 *
 * Central katalog för alla dynamiska BBOX-baserade kartlager-endpoints som
 * exponeras under /api/layers/*. Den här listan används både av frontend
 * (via /api/reference/map-layers) och för smoketest av GIS-ytan.
 *
 * Håll i synk med components/project/MapConfig.ts när nya lager läggs till.
 */

import {
  DATAPORTAL_DATASETS_BASE_URL,
  RAA_KSAMSOK_API_GUIDE_URL,
} from '../constants/culturalHeritageSources';
import { ALL_DATASET_MAP_LAYERS, type DatasetLayerStyle } from './platformMapLayerRegistry';

export type MapLayerActivation = 'IMMEDIATE' | 'PERMIT_REQUIRED';

export type MapLayerGeometryType = 'polygon' | 'line' | 'point' | 'mixed';

export interface MapLayerCatalogEntry {
  key: string;
  label: string;
  endpoint: string;
  bboxRequired: boolean;
  geometry: MapLayerGeometryType;
  source: 'postgis' | 'external' | 'hybrid';
  provider: string;
  activation: MapLayerActivation;
  description?: string;
  /** Om utelämnad fylls standard (dataportal + K-samsök) i /api/reference/map-layers */
  documentationUrls?: string[];
  /** Dataset-lager: stilhint för kartan */
  datasetStyle?: DatasetLayerStyle;
  /** Dataset-lager: min zoom innan bbox-hämtning */
  minZoom?: number;
}

/** Standardreferenser för nedladdnings-/ screening-flöden (dataportal + RAA K-samsök). */
export const MAP_LAYER_DEFAULT_DOCUMENTATION_URLS: readonly string[] = [
  DATAPORTAL_DATASETS_BASE_URL,
  RAA_KSAMSOK_API_GUIDE_URL,
];

export const MAP_LAYER_CATALOG: MapLayerCatalogEntry[] = [
  {
    key: 'postgis_nvr',
    label: 'Skyddad natur (NVR)',
    endpoint: '/api/layers/nvr',
    bboxRequired: false,
    geometry: 'polygon',
    source: 'postgis',
    provider: 'Naturvardsverket',
    activation: 'IMMEDIATE',
    description: 'Naturreservat, nationalparker och övriga skyddade områden från NVR.',
  },
  {
    key: 'natura2000_area',
    label: 'Natura 2000',
    endpoint: '/api/layers/natura2000',
    bboxRequired: false,
    geometry: 'polygon',
    source: 'postgis',
    provider: 'Naturvardsverket / EU',
    activation: 'IMMEDIATE',
    description: 'SCI- och SPA-områden från Natura 2000 i lokal PostGIS.',
  },
  {
    key: 'international_protection',
    label: 'Ramsar / Varldsarv',
    endpoint: '/api/layers/international-protection',
    bboxRequired: false,
    geometry: 'polygon',
    source: 'postgis',
    provider: 'Naturvardsverket / UNESCO / Ramsar',
    activation: 'IMMEDIATE',
    description: 'Internationella skydd som Ramsar och världsarv från lokal PostGIS.',
  },
  {
    key: 'water_protection',
    label: 'Vattenskyddsomraden',
    endpoint: '/api/layers/water-protection',
    bboxRequired: false,
    geometry: 'polygon',
    source: 'postgis',
    provider: 'Naturvardsverket/Lansstyrelsen',
    activation: 'IMMEDIATE',
  },
  {
    key: 'sgu_grundlager',
    label: 'SGU grundlager (jordart/berg)',
    endpoint: '/api/layers/sgu/grundlager',
    bboxRequired: true,
    geometry: 'polygon',
    source: 'postgis',
    provider: 'SGU',
    activation: 'IMMEDIATE',
  },
  {
    key: 'sgu_brunnar_postgis',
    label: 'Brunnar (SGU)',
    endpoint: '/api/layers/sgu/brunnar',
    bboxRequired: true,
    geometry: 'point',
    source: 'postgis',
    provider: 'SGU',
    activation: 'IMMEDIATE',
  },
  {
    key: 'sgu_genomslapplighet',
    label: 'Genomslapplighet',
    endpoint: '/api/layers/sgu/genomslapplighet',
    bboxRequired: true,
    geometry: 'polygon',
    source: 'postgis',
    provider: 'SGU',
    activation: 'IMMEDIATE',
  },
  {
    key: 'sgu_groundwater_magazine',
    label: 'Grundvattenmagasin',
    endpoint: '/api/layers/sgu/grundvattenmagasin',
    bboxRequired: true,
    geometry: 'polygon',
    source: 'postgis',
    provider: 'SGU',
    activation: 'IMMEDIATE',
  },
  {
    key: 'sgu_groundwater_body',
    label: 'Grundvattenforekomster',
    endpoint: '/api/layers/sgu/grundvattenforekomster',
    bboxRequired: true,
    geometry: 'polygon',
    source: 'postgis',
    provider: 'SGU',
    activation: 'IMMEDIATE',
  },
  {
    key: 'sgu_jordskred_raviner',
    label: 'SGU jordskred/raviner',
    endpoint: '/api/layers/sgu/jordskred-raviner',
    bboxRequired: true,
    geometry: 'line',
    source: 'postgis',
    provider: 'SGU',
    activation: 'IMMEDIATE',
  },
  {
    key: 'sgu_coastal_erosion',
    label: 'SGU kusterosion',
    endpoint: '/api/layers/sgu/kusterosion',
    bboxRequired: true,
    geometry: 'mixed',
    source: 'postgis',
    provider: 'SGU',
    activation: 'IMMEDIATE',
    description: 'SGU:s lokala lager för stranderosion längs kust med prognoser, material och skydd.',
  },
  {
    key: 'sgu_highest_coastline',
    label: 'SGU högsta kustlinjen',
    endpoint: '/api/layers/sgu/hogsta-kustlinjen',
    bboxRequired: true,
    geometry: 'mixed',
    source: 'postgis',
    provider: 'SGU',
    activation: 'IMMEDIATE',
    description: 'Punkt- och ytdata för högsta kustlinjen från SGU.',
  },
  {
    key: 'postgis_property',
    label: 'Fastighetsgranser',
    endpoint: '/api/layers/property',
    bboxRequired: true,
    geometry: 'polygon',
    source: 'hybrid',
    provider: 'Lantmateriet/PostGIS',
    activation: 'IMMEDIATE',
  },
  {
    key: 'postgis_lakes',
    label: 'Sjoar',
    endpoint: '/api/layers/hydro.lakes',
    bboxRequired: false,
    geometry: 'polygon',
    source: 'postgis',
    provider: 'Lantmateriet',
    activation: 'IMMEDIATE',
  },
  {
    key: 'postgis_streams',
    label: 'Vattendrag',
    endpoint: '/api/layers/hydro.streams',
    bboxRequired: false,
    geometry: 'line',
    source: 'postgis',
    provider: 'Lantmateriet',
    activation: 'IMMEDIATE',
  },
  {
    key: 'hydro_water_catchment',
    label: 'Avrinningsomraden',
    endpoint: '/api/layers/hydro.water-catchments',
    bboxRequired: true,
    geometry: 'polygon',
    source: 'postgis',
    provider: 'SMHI/HaV',
    activation: 'IMMEDIATE',
  },
  {
    key: 'hydro_main_catchment',
    label: 'Huvudavrinningsomraden',
    endpoint: '/api/layers/hydro.main-catchments',
    bboxRequired: true,
    geometry: 'polygon',
    source: 'postgis',
    provider: 'SMHI',
    activation: 'IMMEDIATE',
  },
  {
    key: 'slu_lake_catchment',
    label: 'SLU sjöavrinningsområden',
    endpoint: '/api/layers/dataset/slu_lake_catchment',
    bboxRequired: true,
    geometry: 'polygon',
    source: 'postgis',
    provider: 'SLU',
    activation: 'IMMEDIATE',
    description:
      'Avrinningsområden kring nationellt övervakade sjöar (SLS + trend). Kompletterar SMHI huvudavrinningsområden.',
    datasetStyle: 'water',
    minZoom: 9,
  },
  {
    key: 'climate_flood_risk',
    label: 'Oversvamningsrisk',
    endpoint: '/api/layers/climate.flood-risk',
    bboxRequired: false,
    geometry: 'polygon',
    source: 'postgis',
    provider: 'MSB',
    activation: 'IMMEDIATE',
  },
  {
    key: 'mark_cover',
    label: 'Marktacke',
    endpoint: '/api/layers/markcover',
    bboxRequired: true,
    geometry: 'polygon',
    source: 'hybrid',
    provider: 'Naturvardsverket/LULC',
    activation: 'IMMEDIATE',
  },
  {
    key: 'raa_fornlamning_wfs',
    label: 'Fornlamningar (RAA WFS)',
    endpoint: '/api/layers/raa/fornlamning',
    bboxRequired: true,
    geometry: 'mixed',
    source: 'external',
    provider: 'Riksantikvarieambetet',
    activation: 'IMMEDIATE',
    description:
      'WFS GetFeature från lamningar_v1 (fornlämning m.m.). Komplettera med K-samsök för beständiga objekt-URI:er.',
    documentationUrls: [
      RAA_KSAMSOK_API_GUIDE_URL,
      'https://pub.raa.se/visning/lamningar_v1/wfs?service=WFS&request=GetCapabilities',
      DATAPORTAL_DATASETS_BASE_URL,
    ],
  },
  ...ALL_DATASET_MAP_LAYERS.map((layer) => ({
    key: layer.key,
    label: layer.label,
    endpoint: `/api/layers/dataset/${layer.key}`,
    bboxRequired: layer.bboxRequired,
    geometry: layer.geometry,
    source: 'postgis' as const,
    provider: layer.provider,
    activation: 'IMMEDIATE' as const,
    description: `PostGIS: ${layer.schema}.${layer.table}`,
    datasetStyle: layer.style,
    minZoom: layer.minZoom,
  })),
];

/**
 * Semantiska GeoJSON-endpoints under `/api/geodata/*` (samma data som motsvarande `/api/layers/*`).
 * Används av smoketest; håll listan i synk med `server/routes/geodata.routes.ts`.
 */
export interface GeodataSmokeEntry {
  key: string;
  endpoint: string;
  /** Query-sträng efter bbox, t.ex. `&limit=500` */
  querySuffix?: string;
}

export const GEODATA_SMOKE_CATALOG: GeodataSmokeEntry[] = [
  { key: 'geodata_soil', endpoint: '/api/geodata/soil' },
  { key: 'geodata_wells', endpoint: '/api/geodata/wells', querySuffix: '&limit=500' },
  { key: 'geodata_lakes', endpoint: '/api/geodata/lakes' },
  { key: 'geodata_streams', endpoint: '/api/geodata/streams' },
  { key: 'geodata_topo_water', endpoint: '/api/geodata/topo-water' },
  { key: 'geodata_topo_buildings', endpoint: '/api/geodata/topo-buildings' },
  { key: 'geodata_topo_mark', endpoint: '/api/geodata/topo-mark' },
  { key: 'geodata_water_protection', endpoint: '/api/geodata/water-protection' },
  { key: 'geodata_protected_nature', endpoint: '/api/geodata/protected-nature' },
  { key: 'geodata_property', endpoint: '/api/geodata/property' },
];

export function findMapLayerByKey(key: string): MapLayerCatalogEntry | undefined {
  return MAP_LAYER_CATALOG.find((item) => item.key === key);
}

export function listMapLayerKeys(): string[] {
  return MAP_LAYER_CATALOG.map((item) => item.key);
}
