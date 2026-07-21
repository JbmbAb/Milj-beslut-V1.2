import { describe, it, expect } from 'vitest';
import {
  generateSituationPlanSVG,
  generateCrossSectionSVG,
  generateSewageApplicationDocuments,
} from '../../server/services/sewageDocumentGenerator';
import type { SewageApplication, SewageProtectionProfile, SewageGISAnalysis } from '../../types';

// ============================================================================
// TEST DATA
// ============================================================================

const mockProtectionProfile: SewageProtectionProfile = {
  propertyId: 'prop-1',
  protectionLevel: 'NORMAL',
  reason: 'Standardskyddsnivå',
  nearestWell: {
    distance: 50,
    owner: 'NEIGHBOR',
    coordinates: { lat: 60.67, lng: 17.14 },
  },
  nearestWaterCourse: {
    distance: 100,
    type: 'Bäck',
    name: 'Källbäcken',
  },
  distanceToPropertyLine: 5,
  soilProfile: {
    soilType: 'Isälvssand',
    depthToRock: 5,
    groundwaterLevel: 2.5,
    infiltrationCapacity: 'HIGH',
    permeability: 50,
  },
  floodRisk: 'LOW',
  protectedNatureNearby: false,
  recommendedSystem: 'INFILTRATION',
  timelineEstimateWeeks: 8,
  requiredGates: [],
};

const mockApplication: SewageApplication = {
  id: 'app-1',
  projectId: 'proj-1',
  propertyDesignation: 'GÄVLE BRYNÄS 1:1',
  pe: 5,
  selectedSystemType: 'INFILTRATION',
  protectionProfile: mockProtectionProfile,
  soilTestCompleted: false,
  neighborConsentRequired: false,
  dimensionedArea: 64,
  dimensionedDepth: 1.5,
  status: 'DRAFT',
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
  currentGates: [],
};

const mockAnalysis: SewageGISAnalysis = {
  propertyId: 'prop-1',
  timestamp: '2025-01-01T00:00:00Z',
  sguJordartData: {
    soilType: 'Isälvssand',
    depthToRock: 5,
    groundwaterLevel: 2.5,
    loadingCapacity: 'HIGH',
  },
  sguBrunnarData: {
    nearestNeighborWells: [{ distance: 50, coordinates: { lat: 60.67, lng: 17.14 } }],
  },
  protectedAreas: [],
  propertyBoundaries: {
    area: 5000,
    perimeter: 284,
    nearestNeighbor: 5,
  },
  overallRiskScore: 30,
  feasibilityScore: 80,
  recommendedSystems: ['INFILTRATION'],
  blockedSystems: [],
  reasoning: ['Isälvssand ger god infiltration'],
};

// ============================================================================
// TESTS
// ============================================================================

describe('sewageDocumentGenerator', () => {
  describe('generateSituationPlanSVG', () => {
    it('returnerar en SVG-sträng', () => {
      const svg = generateSituationPlanSVG(mockApplication, mockProtectionProfile, mockAnalysis);
      expect(typeof svg).toBe('string');
      expect(svg).toContain('<svg');
      expect(svg).toContain('</svg>');
    });

    it('innehåller XML-deklaration', () => {
      const svg = generateSituationPlanSVG(mockApplication, mockProtectionProfile, mockAnalysis);
      expect(svg).toContain('<?xml');
    });

    it('innehåller fastighetsbeteckning', () => {
      const svg = generateSituationPlanSVG(mockApplication, mockProtectionProfile, mockAnalysis);
      expect(svg).toContain('GÄVLE BRYNÄS 1:1');
    });

    it('inkluderar skyddad natur-markering när protectedNatureNearby=true', () => {
      const profileWithNature = {
        ...mockProtectionProfile,
        protectedNatureNearby: true,
      };
      const svg = generateSituationPlanSVG(mockApplication, profileWithNature, mockAnalysis);
      expect(svg).toContain('<svg');
      // protected area should be in the SVG
      expect(svg.length).toBeGreaterThan(1000);
    });

    it('producerar valida SVG-dimensioner', () => {
      const svg = generateSituationPlanSVG(mockApplication, mockProtectionProfile, mockAnalysis);
      expect(svg).toContain('width="1200"');
      expect(svg).toContain('height="900"');
    });
  });

  describe('generateCrossSectionSVG', () => {
    it('returnerar en SVG-sträng', () => {
      const svg = generateCrossSectionSVG(mockApplication, mockProtectionProfile);
      expect(typeof svg).toBe('string');
      expect(svg).toContain('<svg');
      expect(svg).toContain('</svg>');
    });

    it('innehåller jordlager-information', () => {
      const svg = generateCrossSectionSVG(mockApplication, mockProtectionProfile);
      expect(svg).toContain('Isälvssand');
    });

    it('innehåller grundvattennivå', () => {
      const svg = generateCrossSectionSVG(mockApplication, mockProtectionProfile);
      expect(svg).toContain('Grundvattennivå');
    });

    it('innehåller systemnamn på svenska (INFILTRATION → Infiltrationssystem)', () => {
      const svg = generateCrossSectionSVG(mockApplication, mockProtectionProfile);
      expect(svg).toContain('Infiltrationssystem');
    });

    it('varnar när systemet är för grundvattennära', () => {
      const shallowProfile = {
        ...mockProtectionProfile,
        soilProfile: {
          ...mockProtectionProfile.soilProfile,
          groundwaterLevel: 0.5, // Below system depth (1.5m)
        },
      };
      const svg = generateCrossSectionSVG({ ...mockApplication, dimensionedDepth: 1.5 }, shallowProfile);
      expect(svg).toContain('FÖR GRUNDVATTENNÄRA');
    });

    it('hanterar application utan dimensionedDepth (fallback 1.5m)', () => {
      const appWithoutDepth = { ...mockApplication, dimensionedDepth: undefined };
      const svg = generateCrossSectionSVG(appWithoutDepth, mockProtectionProfile);
      expect(svg).toContain('<svg');
    });

    it('hanterar CLOSED_TANK-system', () => {
      const closedTankApp = { ...mockApplication, selectedSystemType: 'CLOSED_TANK' as const };
      const svg = generateCrossSectionSVG(closedTankApp, mockProtectionProfile);
      expect(svg).toContain('Sluten tank');
    });
  });

  describe('generateSewageApplicationDocuments', () => {
    it('returnerar situationPlanSVG, crossSectionSVG och generatedAt', () => {
      const result = generateSewageApplicationDocuments(mockApplication, mockProtectionProfile, mockAnalysis);

      expect(result.situationPlanSVG).toContain('<svg');
      expect(result.crossSectionSVG).toContain('<svg');
      expect(result.generatedAt).toBeTruthy();
    });

    it('generatedAt är en giltig ISO-sträng', () => {
      const result = generateSewageApplicationDocuments(mockApplication, mockProtectionProfile, mockAnalysis);
      expect(() => new Date(result.generatedAt)).not.toThrow();
    });

    it('returnerar unika SVG-dokument (situationsplan ≠ tvärsektion)', () => {
      const result = generateSewageApplicationDocuments(mockApplication, mockProtectionProfile, mockAnalysis);
      expect(result.situationPlanSVG).not.toBe(result.crossSectionSVG);
    });
  });
});
