/**
 * Generic bbox-based map layers from PostGIS - Legacy wrapper delegating to PostgisGeoAdapter.
 */

import type { Bbox } from '../utils/geo/bbox';
import { PostgisGeoAdapter } from '../../src/infrastructure/postgis-geo-adapter';

export type FeatureCollection = {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    geometry: GeoJSON.Geometry;
    properties: Record<string, unknown>;
  }>;
  meta?: Record<string, unknown>;
};

const adapter = new PostgisGeoAdapter();

export async function getDatasetMapLayer(
  layerKey: string,
  bbox: Bbox,
  limit: number = 1500,
): Promise<FeatureCollection> {
  return adapter.getDatasetMapLayer(layerKey, bbox, limit);
}
