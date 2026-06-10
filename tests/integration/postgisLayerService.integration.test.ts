import { describe, expect, it } from 'vitest';
import { getDatasetMapLayer } from '../../server/services/postgisLayerService';
import { GAVLE_BRYNAS_BBOX } from '../helpers/postgisSeed';
import { describeIfDatabaseIntegration } from './integrationTestEnv';

describeIfDatabaseIntegration('postgisLayerService integration', () => {
  it('returns features for seeded sgu_wells layer', async () => {
    const layer = await getDatasetMapLayer('sgu_wells', GAVLE_BRYNAS_BBOX);

    expect(layer.meta?.available).toBe(true);
    expect(layer.meta?.source).toBe('local_postgis');
    expect(layer.features.length).toBeGreaterThan(0);
  });

  it('returns unavailable meta for unknown layer key', async () => {
    const layer = await getDatasetMapLayer('not_a_real_layer_key', GAVLE_BRYNAS_BBOX);

    expect(layer.meta?.available).toBe(false);
    expect(layer.features).toEqual([]);
  });

  it('returns empty features for bbox outside seeded data', async () => {
    const layer = await getDatasetMapLayer('sgu_wells', {
      minLng: 11,
      minLat: 55,
      maxLng: 11.1,
      maxLat: 55.1,
    });

    expect(layer.meta?.available).toBe(true);
    expect(layer.features).toEqual([]);
  });
});
