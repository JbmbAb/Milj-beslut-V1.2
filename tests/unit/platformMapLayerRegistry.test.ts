import { describe, expect, it } from 'vitest';
import {
  ALL_DATASET_MAP_LAYERS,
  findDatasetMapLayer,
  listDatasetMapLayerKeys,
} from '../../server/datasources/platformMapLayerRegistry';

describe('platformMapLayerRegistry', () => {
  it('finds a known platform dataset layer', () => {
    const layer = findDatasetMapLayer('sgu_wells');

    expect(layer).toBeDefined();
    expect(layer?.key).toBe('sgu_wells');
    expect(layer?.schema).toBeTruthy();
    expect(layer?.table).toBeTruthy();
    expect(layer?.bboxRequired).toBe(true);
  });

  it('returns undefined for unknown keys', () => {
    expect(findDatasetMapLayer('definitely_not_a_layer')).toBeUndefined();
  });

  it('lists unique layer keys matching registry entries', () => {
    const keys = listDatasetMapLayerKeys();

    expect(keys.length).toBe(ALL_DATASET_MAP_LAYERS.length);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain('sgu_wells');
    expect(keys).toContain('raa_building_ruin');
  });
});
