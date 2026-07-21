import { describe, it, expect } from 'vitest';
import type { SewageApplication, SewageGISAnalysis, SewageProtectionProfile } from '../../types';

// ============================================================================
// TEST DATA
// ============================================================================

const mockProtectionProfile: SewageProtectionProfile = {
  propertyId: 'prop-test',
  protectionLevel: 'NORMAL',
  reason: 'Normalskyddsnivå',
  nearestWell: {
    distance: 60,
    owner: 'NEIGHBOR',
    coordinates: { lat: 59.33, lng: 18.07 },
  },
  nearestWaterCourse: {
    distance: 120,
    type: 'Å',
    name: 'Testån',
  },
  distanceToPropertyLine: 6,
  soilProfile: {
    soilType: 'Morän',
    depthToRock: 4,
    groundwaterLevel: 2,
    infiltrationCapacity: 'MEDIUM',
    permeability: 25,
  },
  floodRisk: 'LOW',
  protectedNatureNearby: false,
  recommendedSystem: 'SOIL_BED',
  timelineEstimateWeeks: 10,
  requiredGates: [],
};

const mockAnalysis: SewageGISAnalysis = {
  propertyId: 'prop-test',
  timestamp: '2025-01-01T00:00:00Z',
  sguJordartData: {
    soilType: 'Morän',
    depthToRock: 4,
    groundwaterLevel: 2,
    loadingCapacity: 'MEDIUM',
  },
  sguBrunnarData: {
    nearestNeighborWells: [{ distance: 60, coordinates: { lat: 59.33, lng: 18.07 } }],
  },
  protectedAreas: [],
  propertyBoundaries: {
    area: 3000,
    perimeter: 220,
    nearestNeighbor: 6,
  },
  overallRiskScore: 40,
  feasibilityScore: 70,
  recommendedSystems: ['SOIL_BED'],
  blockedSystems: [],
  reasoning: ['Morän kräver markbädd'],
};

const mockApplication: SewageApplication = {
  id: 'app-svc-1',
  projectId: 'proj-2',
  propertyDesignation: 'STOCKHOLM ÖSTERMALM 2:3',
  pe: 4,
  selectedSystemType: 'SOIL_BED',
  protectionProfile: mockProtectionProfile,
  soilTestCompleted: true,
  ltar: 30,
  neighborConsentRequired: false,
  dimensionedArea: 50,
  dimensionedDepth: 1.2,
  status: 'UNDER_REVIEW',
  createdAt: '2025-02-01T00:00:00Z',
  updatedAt: '2025-02-01T00:00:00Z',
  currentGates: [],
};

// ============================================================================
// TESTS
// ============================================================================

describe('sewageDocumentGeneratorService', () => {
  describe('generateSewageDocuments', () => {
    it('returnerar situationPlan, crossSection och applicationSummary', async () => {
      const { generateSewageDocuments } =
        await import('../../server/services/sewageDocumentGeneratorService');

      const result = await generateSewageDocuments({
        application: mockApplication,
        gisAnalysis: mockAnalysis,
        protectionProfile: mockProtectionProfile,
        applicantName: 'Anna Andersson',
        applicantEmail: 'anna@example.se',
        latitude: 59.33,
        longitude: 18.07,
      });

      expect(result.situationPlan).toBeDefined();
      expect(result.crossSection).toBeDefined();
      expect(result.applicationSummary).toBeDefined();
    });

    it('situationPlan har format SVG', async () => {
      const { generateSewageDocuments } =
        await import('../../server/services/sewageDocumentGeneratorService');

      const result = await generateSewageDocuments({
        application: mockApplication,
        gisAnalysis: mockAnalysis,
        protectionProfile: mockProtectionProfile,
        applicantName: 'Test Person',
        applicantEmail: 'test@test.se',
        latitude: 59.33,
        longitude: 18.07,
      });

      expect(result.situationPlan.format).toBe('SVG');
      expect(result.situationPlan.data).toContain('<svg');
    });

    it('crossSection har format SVG', async () => {
      const { generateSewageDocuments } =
        await import('../../server/services/sewageDocumentGeneratorService');

      const result = await generateSewageDocuments({
        application: mockApplication,
        gisAnalysis: mockAnalysis,
        protectionProfile: mockProtectionProfile,
        applicantName: 'Test Person',
        applicantEmail: 'test@test.se',
        latitude: 59.33,
        longitude: 18.07,
      });

      expect(result.crossSection.format).toBe('SVG');
      expect(result.crossSection.data).toContain('<svg');
    });

    it('applicationSummary innehåller HTML', async () => {
      const { generateSewageDocuments } =
        await import('../../server/services/sewageDocumentGeneratorService');

      const result = await generateSewageDocuments({
        application: mockApplication,
        gisAnalysis: mockAnalysis,
        protectionProfile: mockProtectionProfile,
        applicantName: 'Test Person',
        applicantEmail: 'test@test.se',
        latitude: 59.33,
        longitude: 18.07,
      });

      expect(result.applicationSummary.data).toContain('<html');
      expect(result.applicationSummary.data).toContain('STOCKHOLM ÖSTERMALM 2:3');
    });

    it('situationPlan har dimensioner (width + height)', async () => {
      const { generateSewageDocuments } =
        await import('../../server/services/sewageDocumentGeneratorService');

      const result = await generateSewageDocuments({
        application: mockApplication,
        gisAnalysis: mockAnalysis,
        protectionProfile: mockProtectionProfile,
        applicantName: 'Test',
        applicantEmail: 'test@test.se',
        latitude: 59.33,
        longitude: 18.07,
      });

      expect(result.situationPlan.width).toBeGreaterThan(0);
      expect(result.situationPlan.height).toBeGreaterThan(0);
    });

    it('hanterar CLOSED_TANK-system', async () => {
      const { generateSewageDocuments } =
        await import('../../server/services/sewageDocumentGeneratorService');

      const closedTankApp = { ...mockApplication, selectedSystemType: 'CLOSED_TANK' as const };

      const result = await generateSewageDocuments({
        application: closedTankApp,
        gisAnalysis: mockAnalysis,
        protectionProfile: mockProtectionProfile,
        applicantName: 'Test Person',
        applicantEmail: 'test@test.se',
        latitude: 59.33,
        longitude: 18.07,
      });

      expect(result.crossSection.data).toContain('Tank');
    });

    it('applicationSummary nämner sökt mark och lagstiftning', async () => {
      const { generateSewageDocuments } =
        await import('../../server/services/sewageDocumentGeneratorService');

      const result = await generateSewageDocuments({
        application: mockApplication,
        gisAnalysis: mockAnalysis,
        protectionProfile: mockProtectionProfile,
        applicantName: 'Test Person',
        applicantEmail: 'test@test.se',
        latitude: 59.33,
        longitude: 18.07,
      });

      expect(result.applicationSummary.data).toContain('Miljöbalken');
    });
  });
});
