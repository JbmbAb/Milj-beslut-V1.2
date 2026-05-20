import { describe, expect, it, vi } from 'vitest';

// Mock prisma (used by module level imports)
vi.mock('../../db.server', () => ({
  prisma: {
    project: {
      findUnique: vi.fn(),
    },
  },
}));

import {
  analyzeSewageProperty,
  generateSewageProtectionProfile,
} from '../../server/services/sewageAnalysisService';

// The service uses hardcoded internal mock data so we can test all branch logic
// by directly calling the exported functions with different inputs.

describe('sewageAnalysisService', () => {
  describe('analyzeSewageProperty', () => {
    it('returnerar GIS-analys med alla fält', async () => {
      const result = await analyzeSewageProperty({
        propertyDesignation: 'GÄVLE BRYNÄS 1:1',
        municipalityCode: '2180',
        latitude: 60.67,
        longitude: 17.14,
        pe: 5,
      });

      expect(result.propertyId).toBe('GÄVLE BRYNÄS 1:1');
      expect(result.overallRiskScore).toBeGreaterThanOrEqual(0);
      expect(result.overallRiskScore).toBeLessThanOrEqual(100);
      expect(result.feasibilityScore).toBeGreaterThanOrEqual(0);
      expect(result.feasibilityScore).toBeLessThanOrEqual(100);
      expect(Array.isArray(result.recommendedSystems)).toBe(true);
      expect(Array.isArray(result.blockedSystems)).toBe(true);
      expect(Array.isArray(result.reasoning)).toBe(true);
    });

    it('har timestamp i ISO-format', async () => {
      const result = await analyzeSewageProperty({
        propertyDesignation: 'STOCKHOLM CENTRUM 1:1',
        municipalityCode: '0180',
        latitude: 59.33,
        longitude: 18.07,
        pe: 1,
      });

      expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('returnerar SGU jordart- och brunnsdata', async () => {
      const result = await analyzeSewageProperty({
        propertyDesignation: 'MALMÖ LIMHAMN 1:1',
        municipalityCode: '1280',
        latitude: 55.6,
        longitude: 13.0,
        pe: 10,
      });

      expect(result.sguJordartData).toBeDefined();
      expect(result.sguBrunnarData).toBeDefined();
      expect(result.protectedAreas).toBeDefined();
    });

    it('returnerar rekommenderat system baserat på jordkapacitet', async () => {
      const result = await analyzeSewageProperty({
        propertyDesignation: 'GÄVLE BRYNÄS 1:1',
        municipalityCode: '2180',
        latitude: 60.67,
        longitude: 17.14,
        pe: 5,
      });

      // Internal mock returns MEDIUM capacity → MINI_PLANT_BDTA recommended
      expect(result.recommendedSystems).toContain('MINI_PLANT_BDTA');
    });
  });

  describe('generateSewageProtectionProfile', () => {
    const baseAnalysis = {
      propertyId: 'GÄVLE BRYNÄS 1:1',
      timestamp: new Date().toISOString(),
      sguJordartData: {
        soilType: 'Isälvssand',
        depthToRock: 4.5,
        groundwaterLevel: 1.2,
        loadingCapacity: 'MEDIUM' as const,
      },
      sguBrunnarData: {
        nearestOwnWell: { distance: 38, coordinates: { lat: 60.671, lng: 17.142 } },
        nearestNeighborWells: [{ distance: 65, coordinates: { lat: 60.673, lng: 17.139 } }],
      },
      propertyBoundaries: {
        area: 30000,
        perimeter: 700,
        nearestNeighbor: 5.2,
      },
      protectedAreas: [
        { name: 'Vattenskyddsområde Stora sjön', type: 'WATER_PROTECTION' as const, distance: 250 },
      ],
      floodRiskZone: { level: 'LOW' as const, floodFrequency: '1:100 years' },
      overallRiskScore: 40,
      feasibilityScore: 70,
      recommendedSystems: ['MINI_PLANT_BDTA' as const],
      blockedSystems: ['INFILTRATION' as const],
      reasoning: ['Medel jordkapacitet → minireningsverk'],
    };

    it('sätter HIGH skyddsnivå när skyddat område finns', async () => {
      const profile = await generateSewageProtectionProfile(baseAnalysis, '2180');

      expect(profile.protectionLevel).toBe('HIGH');
      expect(profile.reason).toContain('Vattenskyddsområde');
    });

    it('sätter NORMAL skyddsnivå utan skyddat område', async () => {
      const analysisWithoutProtection = { ...baseAnalysis, protectedAreas: [] };
      const profile = await generateSewageProtectionProfile(analysisWithoutProtection, '2180');

      expect(profile.protectionLevel).toBe('NORMAL');
      expect(profile.reason).toBe('Normal skyddsnivå');
    });

    it('returnerar soilProfile med korrekt data', async () => {
      const profile = await generateSewageProtectionProfile(baseAnalysis, '2180');

      expect(profile.soilProfile.soilType).toBe('Isälvssand');
      expect(profile.soilProfile.groundwaterLevel).toBe(1.2);
      expect(profile.soilProfile.infiltrationCapacity).toBe('MEDIUM');
    });

    it('anger permeabilitet 100 för HIGH kapacitet', async () => {
      const analysisHighCap = {
        ...baseAnalysis,
        protectedAreas: [],
        sguJordartData: { ...baseAnalysis.sguJordartData, loadingCapacity: 'HIGH' as const },
      };
      const profile = await generateSewageProtectionProfile(analysisHighCap, '0180');

      expect(profile.soilProfile.permeability).toBe(100);
    });

    it('anger permeabilitet 50 för MEDIUM kapacitet', async () => {
      const profile = await generateSewageProtectionProfile(baseAnalysis, '2180');

      expect(profile.soilProfile.permeability).toBe(50);
    });

    it('anger CLOSED_TANK som default om inga system rekommenderas', async () => {
      const analysisNoSystems = { ...baseAnalysis, recommendedSystems: [] };
      const profile = await generateSewageProtectionProfile(analysisNoSystems, '2180');

      expect(profile.recommendedSystem).toBe('CLOSED_TANK');
    });

    it('returnerar requiredGates lista', async () => {
      const profile = await generateSewageProtectionProfile(baseAnalysis, '2180');

      expect(profile.requiredGates).toHaveLength(3);
      const gateIds = profile.requiredGates.map((g) => g.id);
      expect(gateIds).toContain('gate-SEWAGE_PROTECTION_LEVEL');
      expect(gateIds).toContain('gate-SOIL_TEST_COMPLETED');
      expect(gateIds).toContain('gate-NEIGHBOR_CONSENT');
    });

    it('grannemedgivande krävs när brunn < 50m', async () => {
      // nearestOwnWell.distance = 38 in baseAnalysis → < 50
      const profile = await generateSewageProtectionProfile(baseAnalysis, '2180');

      const neighborGate = profile.requiredGates.find((g) => g.id === 'gate-NEIGHBOR_CONSENT');
      expect(neighborGate?.description).toContain('Krävs');
    });

    it('grannemedgivande ej krävs när brunn >= 50m', async () => {
      const analysisWithFarWell = {
        ...baseAnalysis,
        sguBrunnarData: {
          nearestOwnWell: { distance: 60, coordinates: { lat: 60.671, lng: 17.142 } },
          nearestNeighborWells: [],
        },
      };
      const profile = await generateSewageProtectionProfile(analysisWithFarWell, '2180');

      const neighborGate = profile.requiredGates.find((g) => g.id === 'gate-NEIGHBOR_CONSENT');
      expect(neighborGate?.description).toContain('Ej krävs');
    });

    it('inkluderar protectedNatureNearby baserat på protectedAreas', async () => {
      const profile = await generateSewageProtectionProfile(baseAnalysis, '2180');

      expect(profile.protectedNatureNearby).toBe(true);
    });

    it('protectedNatureNearby är false utan skyddade areas', async () => {
      const analysisEmpty = { ...baseAnalysis, protectedAreas: [] };
      const profile = await generateSewageProtectionProfile(analysisEmpty, '2180');

      expect(profile.protectedNatureNearby).toBe(false);
    });
  });
});
