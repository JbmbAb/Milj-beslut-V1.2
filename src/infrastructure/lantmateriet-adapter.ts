/**
 * Hexagonal geo adapter — local PostGIS only (Mimers Brunn / offline-first UI).
 * Live Lantmäteriet HTTP is disabled; harvest/import remains outside this adapter.
 */
import { IGeoProvider } from '../domain/geo-repository.interface';
import { PropertyInfo, MunicipalityInfo, GeoAssessment } from '../domain/geo';
import { logger } from '../../server/logger';
import { tryFetchLocalPropertyGeometry } from '../../server/services/hybridGeoService';

export class LantmaterietAdapter implements IGeoProvider {
  async fetchPropertyInfo(designation: string): Promise<PropertyInfo | null> {
    const mode = (process.env.PROPERTY_LOOKUP_MODE || 'postgis').toLowerCase();
    if (mode === 'live' || mode === 'api') {
      logger.warn('LantmaterietAdapter: live LM disabled; use PostGIS', { designation, mode });
      return null;
    }

    try {
      const local = await tryFetchLocalPropertyGeometry(designation);
      if (local) {
        logger.info('LantmaterietAdapter: Found property in PostGIS', { designation });
        const props = (local.boundaries as { properties?: Record<string, unknown> })?.properties || {};
        return {
          id: designation,
          designation: local.designation,
          municipality: String(props.kommunnamn || 'Okänt'),
          areaM2: typeof props.area === 'number' ? props.area : undefined,
          ownerName: 'Redacted (Local)',
          centroid: undefined,
        };
      }
      return null;
    } catch (dbError) {
      logger.error('LantmaterietAdapter: PostGIS lookup failed', { error: dbError });
      return null;
    }
  }

  async searchMunicipality(name: string): Promise<MunicipalityInfo | null> {
    logger.warn('LantmaterietAdapter: municipality lookup is not configured', { name });
    return null;
  }

  async assessRisk(_coords: { lat: number; lng: number }): Promise<GeoAssessment[]> {
    return [];
  }
}
