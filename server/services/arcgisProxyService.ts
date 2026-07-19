import fetch from 'node-fetch';
import type { Bbox } from '../utils/geo/bbox';
import { logger } from '../logger';

export interface ArcGISFeatureCollection {
  type: 'FeatureCollection';
  features: any[];
  meta: Record<string, any>;
}

/**
 * Proxy-tjänst för att hämta data från externa ArcGIS REST MapServer-lager som GeoJSON.
 */
export async function getArcGisLayerAsGeoJson(
  restUrl: string,
  bbox: Bbox,
  limit: number = 1000
): Promise<ArcGISFeatureCollection> {
  // ArcGIS REST query-parameter för BBOX: minX,minY,maxX,maxY
  const arcgisBbox = `${bbox.minLng},${bbox.minLat},${bbox.maxLng},${bbox.maxLat}`;
  
  // Vi antar lager 0 om inget annat anges i URL:en (standard för MapServer-tjänster med ett huvudlager)
  const queryUrl = `${restUrl}/0/query?f=geojson&returnGeometry=true&spatialRel=esriSpatialRelIntersects&geometry=${encodeURIComponent(arcgisBbox)}&geometryType=esriGeometryEnvelope&inSR=4326&outSR=4326&resultRecordCount=${limit}`;

  try {
    const response = await fetch(queryUrl);
    if (!response.ok) {
      throw new Error(`ArcGIS REST fel: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as any;
    return {
      type: 'FeatureCollection',
      features: data.features || [],
      meta: {
        source: 'external_arcgis',
        available: true,
        restUrl,
        featureCount: (data.features || []).length,
        limit,
      }
    };
  } catch (error: any) {
    logger.error('ArcGIS Layer fetch failed', { url: restUrl, error: error.message });
    throw error;
  }
}
