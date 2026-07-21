/**
 * layerRegistry.ts
 * Central registry for all spatial layers in the PostGIS database.
 */

export type LayerKind = 'mvt' | 'raster' | 'geojson';

export interface LayerMetadata {
  schema: string;
  table: string;
  geomColumn?: string;
  rasterColumn?: string;
  kind: LayerKind;
  id: string;
  aliases?: string[];
}

export const layerRegistry: Record<string, LayerMetadata> = {
  // --- SGU (Geology & Groundwater) ---
  'sgu.jordarter': {
    id: 'sgu.jordarter',
    schema: 'sgu',
    table: 'jordarter25k_100k',
    geomColumn: 'geom',
    kind: 'mvt',
    aliases: ['sgu.jordarter', 'sgu/jordarter'],
  },
  'sgu.berggrund': {
    id: 'sgu.berggrund',
    schema: 'sgu',
    table: 'berggrund50k_250k',
    geomColumn: 'geom',
    kind: 'mvt',
  },
  'sgu.brunnar': {
    id: 'sgu.brunnar',
    schema: 'sgu',
    table: 'brunnar',
    geomColumn: 'geom',
    kind: 'mvt',
  },

  // --- NATURVARDSVERKET (Protected Areas & Landcover) ---
  'nvr.naturreservat': {
    id: 'nvr.naturreservat',
    schema: 'staging',
    table: 'nr_polygon',
    geomColumn: 'geom',
    kind: 'mvt',
  },
  'nvr.natura2000_spa': {
    id: 'nvr.natura2000_spa',
    schema: 'staging',
    table: 'spa_rikstackande',
    geomColumn: 'geom',
    kind: 'mvt',
  },
  'nvr.vmi': {
    id: 'nvr.vmi',
    schema: 'staging',
    table: 'vmi_ytor',
    geomColumn: 'geom',
    kind: 'mvt',
  },
  'nvr.marktacke_2023': {
    id: 'nvr.marktacke_2023',
    schema: 'staging',
    table: 'nmd2023bas_v2_1',
    rasterColumn: 'rast',
    kind: 'raster',
    aliases: ['staging.nmd2023', 'nmd2023', 'nvr.nmd2023'],
  },

  // --- SMHI (Hydrography) ---
  'smhi.svar_2022': {
    id: 'smhi.svar_2022',
    schema: 'staging',
    table: 'svar2022_delavrinningsomraden',
    geomColumn: 'geom',
    kind: 'mvt',
  },

  // --- LANTMATERIET (Mapping & Property) ---
  'lantmateriet.fastighet': {
    id: 'lantmateriet.fastighet',
    schema: 'lantmateriet',
    table: 'fastighetsinformation',
    geomColumn: 'geom',
    kind: 'mvt',
  },
  'lantmateriet.mark': {
    id: 'lantmateriet.mark',
    schema: 'lantmateriet',
    table: 'mark_sverige',
    geomColumn: 'geom',
    kind: 'mvt',
  },
  'lantmateriet.hojd': {
    id: 'lantmateriet.hojd',
    schema: 'lantmateriet',
    table: 'hojd_1m',
    rasterColumn: 'rast',
    kind: 'raster',
  },

  // --- MSB (Risks) ---
  'msb.oversvamningsrisk': {
    id: 'msb.oversvamningsrisk',
    schema: 'msb',
    table: 'oversvamning_nationell',
    geomColumn: 'geom',
    kind: 'mvt',
  },
};

function normalizeLayerId(layerId: string): string {
  return layerId.trim().replace(/\//g, '.');
}

export function getLayer(layerId: string): LayerMetadata | undefined {
  const normalizedId = normalizeLayerId(layerId);
  const directLayer = layerRegistry[normalizedId];
  if (directLayer) {
    return directLayer;
  }

  return Object.values(layerRegistry).find((layer) =>
    layer.aliases?.some((alias) => normalizeLayerId(alias) === normalizedId),
  );
}
