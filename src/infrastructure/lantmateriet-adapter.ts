/**
 * Hexagonal adapter (LANTMATERIET_CLIENT_ID / PROPERTY_ENDPOINT).
 * HTTP-uppslag i produktion går via POST /api/property/lookup → server/services/lantmaterietService.ts
 * (CONSUMER_KEY/SECRET eller ACCESS_TOKEN). Utöka helst lantmaterietService, inte denna klass.
 */
import { IGeoProvider } from '../domain/geo-repository.interface';
import { PropertyInfo, MunicipalityInfo, GeoAssessment } from '../domain/geo';
import { logger } from '../../server/logger';
import { tryFetchLocalPropertyGeometry } from '../../server/services/hybridGeoService';

export class LantmaterietAdapter implements IGeoProvider {
  private tokenCache: { token: string; expiresAt: number } | null = null;

  async fetchPropertyInfo(designation: string): Promise<PropertyInfo | null> {
    const mode = (process.env.PROPERTY_LOOKUP_MODE || 'postgis').toLowerCase();

    // Mimers Brunn: PostGIS först. Live LM endast vid explicit mode=live.
    if (mode !== 'live') {
      try {
        const local = await tryFetchLocalPropertyGeometry(designation);
        if (local) {
          logger.info('LantmaterietAdapter: Found property in PostGIS', { designation });
          const props = (local.boundaries as any)?.properties || {};
          return {
            id: designation,
            designation: local.designation,
            municipality: props.kommunnamn || 'Okänt',
            areaM2: props.area,
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

    try {
      const token = await this.getAccessToken();
      const endpoint = process.env.LANTMATERIET_PROPERTY_ENDPOINT;

      if (!endpoint) {
        logger.warn('LantmaterietAdapter: No property endpoint configured');
        return null;
      }

      const url = `${endpoint}?designation=${encodeURIComponent(designation)}`;
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Lantmäteriet API returned ${response.status}`);
      }

      const data = await response.json();
      return this.mapToPropertyInfo(data);
    } catch (error) {
      logger.error('LantmaterietAdapter: Error fetching property', { designation, error });
      return null;
    }
  }

  async searchMunicipality(name: string): Promise<MunicipalityInfo | null> {
    logger.warn('LantmaterietAdapter: municipality lookup is not configured', { name });
    return null;
  }

  async assessRisk(_coords: { lat: number; lng: number }): Promise<GeoAssessment[]> {
    // This would typically call SGU or NV API
    // Placeholder for hexagonal migration
    return [];
  }

  private async getAccessToken(): Promise<string> {
    if (this.tokenCache && this.tokenCache.expiresAt > Date.now()) {
      return this.tokenCache.token;
    }

    const clientId = process.env.LANTMATERIET_CLIENT_ID;
    const clientSecret = process.env.LANTMATERIET_CLIENT_SECRET;
    const tokenUrl = process.env.LANTMATERIET_TOKEN_URL;

    if (!clientId || !clientSecret || !tokenUrl) {
      throw new Error('Missing Lantmäteriet credentials');
    }

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
        scope: 'ogc-features:fastighetsindelning.read',
      }),
    });

    if (!response.ok) throw new Error('Failed to fetch Lantmäteriet token');

    const data = await response.json();
    this.tokenCache = {
      token: data.access_token,
      expiresAt: Date.now() + (data.expires_in - 60) * 1000,
    };

    return data.access_token;
  }

  private mapToPropertyInfo(data: any): PropertyInfo {
    // Mapping logic for OGC Features / FAPI structure
    return {
      id: data.id || 'unknown',
      designation: data.designation || 'Unknown',
      municipality: data.municipality || 'Unknown',
      areaM2: data.area,
      ownerName: data.owner,
      centroid: data.centroid,
    };
  }
}
