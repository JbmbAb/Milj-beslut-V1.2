import { describe, expect, it } from 'vitest';
import {
  GEODATA_SMOKE_CATALOG,
  MAP_LAYER_CATALOG,
  findMapLayerByKey,
  listMapLayerKeys,
} from '../../server/datasources/mapLayerCatalog';
import { DYNAMIC_BBOX_LAYER_CONFIG } from '../../components/project/MapConfig';

/** Paths used by LocalizationStudyUI GEODATA_LAYERS (keep in sync with components/LocalizationStudyUI.tsx). */
const LOCALIZATION_GEODATA_PATHS: Record<string, string> = {
  soil: 'soil',
  wells: 'wells',
  lakes: 'lakes',
  streams: 'streams',
  topoWater: 'topo-water',
  topoBuildings: 'topo-buildings',
  topoMark: 'topo-mark',
  waterProtection: 'water-protection',
  protectedNature: 'protected-nature',
  property: 'property',
};

describe('mapLayerCatalog', () => {
  it('has required fields for every catalog entry', () => {
    const keys = MAP_LAYER_CATALOG.map((entry) => entry.key);
    expect(keys.length).toBeGreaterThan(0);

    for (const entry of MAP_LAYER_CATALOG) {
      expect(entry.key.length).toBeGreaterThan(0);
      expect(entry.endpoint.startsWith('/api/')).toBe(true);
      expect(typeof entry.bboxRequired).toBe('boolean');
      expect(entry.label.length).toBeGreaterThan(0);
    }
  });

  it('exposes listMapLayerKeys and findMapLayerByKey consistently', () => {
    const keys = listMapLayerKeys();
    expect(keys.length).toBe(MAP_LAYER_CATALOG.length);
    expect(findMapLayerByKey('postgis_nvr')?.endpoint).toBe('/api/layers/nvr');
    expect(findMapLayerByKey('missing-key')).toBeUndefined();
  });

  it('aligns core dynamic bbox endpoints with MapConfig', () => {
    const sharedKeys = ['postgis_nvr', 'water_protection', 'postgis_property', 'climate_flood_risk'] as const;

    for (const key of sharedKeys) {
      const catalog = findMapLayerByKey(key);
      const config = DYNAMIC_BBOX_LAYER_CONFIG[key];
      expect(catalog?.endpoint).toBe(config.endpoint);
    }
  });

  it('aligns GEODATA_SMOKE_CATALOG with LocalizationStudyUI geodata paths', () => {
    for (const smoke of GEODATA_SMOKE_CATALOG) {
      const path = smoke.endpoint.replace('/api/geodata/', '');
      const uiEntry = Object.entries(LOCALIZATION_GEODATA_PATHS).find(([, p]) => p === path);
      expect(uiEntry, `missing LocalizationStudyUI path for ${smoke.endpoint}`).toBeDefined();
    }
  });
});
