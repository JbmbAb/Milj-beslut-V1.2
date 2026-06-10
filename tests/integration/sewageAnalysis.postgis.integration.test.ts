import { describe, expect, it } from 'vitest';
import { analyzeSewageProperty } from '../../server/services/sewageAnalysisService';
import { describeIfDatabaseIntegration } from './integrationTestEnv';

describeIfDatabaseIntegration('sewageAnalysisService PostGIS integration', () => {
  it('reads local property, SGU and protection data without live APIs', async () => {
    const result = await analyzeSewageProperty({
      propertyDesignation: 'GÄVLE BRYNÄS 1:1',
      municipalityCode: '2180',
      latitude: 60.67,
      longitude: 17.14,
      pe: 5,
    });

    expect(result.propertyId).toBe('GÄVLE BRYNÄS 1:1');
    expect(result.sguJordartData.soilType).toBe('Morän');
    expect(result.protectedAreas.length).toBeGreaterThan(0);
    expect(result.propertyBoundaries.nearestNeighbor).toBe(10);
    expect(result.feasibilityScore).toBeGreaterThan(0);
  });

  it('returns analysis when property is not in registerenhetsomradesytor', async () => {
    const result = await analyzeSewageProperty({
      propertyDesignation: 'UNKNOWN TRAKT 99:99',
      municipalityCode: '2180',
      latitude: 60.67,
      longitude: 17.14,
      pe: 2,
    });

    expect(result.propertyBoundaries.nearestNeighbor).toBe(5);
    expect(result.sguJordartData.soilType).toBe('Morän');
  });
});
