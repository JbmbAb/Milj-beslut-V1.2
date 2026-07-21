import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGenerateContent = vi.fn();

vi.mock('../../server/services/vertexAiService', () => ({
  generateTextWithVertex: vi.fn((prompt: string, opts?: unknown) => mockGenerateContent(prompt, opts)),
  generateJsonWithVertex: vi.fn(async () => null),
  vertexConfigStatus: vi.fn(() => ({
    configured: true,
    missing: [],
    projectId: 'test',
    location: 'europe-west1',
  })),
  __resetVertexClientForTest: vi.fn(),
}));

vi.mock('../../db.server', () => ({
  prisma: {
    project: { findUnique: vi.fn() },
  },
}));

import { generateGreenCheck } from '../../server/services/greenCheckGeneratorService';
import type { GreenCheckRequest } from '../../server/services/greenCheckGeneratorService';

const validJsonResponse = JSON.stringify({
  esgRating: {
    overallScore: 75,
    rating: 'A',
    environmentalScore: 80,
    socialScore: 70,
    governanceScore: 75,
    strengths: ['Förnybar energi', 'Låga utsläpp'],
    weaknesses: ['Ingen CSRD-rapportering ännu'],
  },
  euTaxonomyCompliance: {
    alignedActivities: [],
    transitionActivities: [],
    nonAlignedActivities: [],
    alignmentPercentage: 60,
    transitionPercentage: 20,
    doNoSignificantHarmAssessment: {
      climateChange: 'Godkänd',
      waterPollution: 'Godkänd',
      circularEconomy: 'Under granskning',
      pollution: 'Godkänd',
      biodiversity: 'Godkänd',
      overallStatus: 'REVIEW_NEEDED',
    },
  },
  regulatoryRiskAssessment: {
    overallRiskScore: 35,
    csrdCompliance: {
      required: true,
      reason: 'Över tröskel',
      deadline: '2026-01-01',
      riskLevel: 'MEDIUM',
    },
    taxonomyRisks: { greenwashingRisk: 20, mismatchRisk: 15, transitionRisk: 25 },
    bankingDirectiveRisks: { capitalRequirement: 'Normalt', liquidityRequirement: 'OK', riskScore: 30 },
    upcomingRegulations: [],
  },
  greenFinanceEligibility: {
    euGreenBondEligible: true,
    sustainabilityLinkedLoanEligible: true,
    euFundingEligible: false,
    publicGreenFinanceEligible: true,
    criteria: [],
    estimatedLoanTerms: { rateReduction: '-0.25%', volumeAvailable: '50M SEK' },
    nextSteps: [],
  },
  financialMetrics: {
    greenAssetRatio: 0.45,
    sustainabilityLinkedFinancing: 0.3,
    stranded_asset_risk: 0.1,
  },
  csrdReportingRequirements: [],
  complianceChecklist: [],
  recommendations: [],
});

const baseRequest: GreenCheckRequest = {
  organizationNumber: '556700-0000',
  organizationName: 'Testbolaget AB',
  projectDescription: 'Installation av solceller på industritak i Gävle',
  investmentAmount: 2_000_000,
  sector: 'renewable_energy',
  latitude: 60.67,
  longitude: 17.14,
};

describe('greenCheckGeneratorService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('generateGreenCheck', () => {
    it('returnerar GeneratedGreenCheck med korrekt ESG-rating', async () => {
      mockGenerateContent.mockResolvedValue(validJsonResponse);

      const result = await generateGreenCheck(baseRequest);

      expect(result.organizationNumber).toBe('556700-0000');
      expect(result.esgRating.overallScore).toBe(75);
      expect(result.esgRating.rating).toBe('A');
    });

    it('innehåller sourceTracking med GEMINI_AI', async () => {
      mockGenerateContent.mockResolvedValue(validJsonResponse);

      const result = await generateGreenCheck(baseRequest);

      expect(result.sourceTracking).toBeDefined();
      const geminiSource = result.sourceTracking.find((s) => s.source === 'GEMINI_AI');
      expect(geminiSource).toBeDefined();
    });

    it('innehåller externalSourcesUsed', async () => {
      mockGenerateContent.mockResolvedValue(validJsonResponse);

      const result = await generateGreenCheck(baseRequest);

      expect(result.externalSourcesUsed.length).toBeGreaterThan(0);
      expect(result.externalSourcesUsed).toContain('EU Taxonomy Regulation (2020/852)');
    });

    it('innehåller generatedAt som ISO-sträng', async () => {
      mockGenerateContent.mockResolvedValue(validJsonResponse);

      const result = await generateGreenCheck(baseRequest);
      expect(() => new Date(result.generatedAt)).not.toThrow();
    });

    it('kastar vid Gemini API-fel', async () => {
      mockGenerateContent.mockRejectedValue(new Error('Gemini timeout'));

      await expect(generateGreenCheck(baseRequest)).rejects.toThrow(
        'Failed to generate green check assessment',
      );
    });

    it('hanterar request utan valfria fält', async () => {
      mockGenerateContent.mockResolvedValue(validJsonResponse);

      const minimalRequest: GreenCheckRequest = {
        organizationNumber: '556700-1111',
        projectDescription: 'Ny fabrik',
      };

      const result = await generateGreenCheck(minimalRequest);
      expect(result.organizationNumber).toBe('556700-1111');
    });
  });
});
