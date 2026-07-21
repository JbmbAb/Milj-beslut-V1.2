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

vi.mock('../../server/services/sguService', () => ({
  fetchGeologicalData: vi.fn(async () => ({
    soilType: 'Morän',
    groundwaterVulnerability: 'Låg',
  })),
}));

vi.mock('../../server/services/hybridGeoService', () => ({
  tryFetchLocalPropertyGeometry: vi.fn(async () => null),
}));

vi.mock('../../db.server', () => ({
  prisma: {
    project: { findUnique: vi.fn() },
  },
}));

import { prisma } from '../../db.server';
import { setAiProvider } from '../../server/services/aiProviderImplementation';
import { generatePermitApplication } from '../../server/services/permitApplicationGeneratorService';
import type { PermitApplicationRequest } from '../../server/services/permitApplicationGeneratorService';

let testAiProvider: {
  generateText: () => Promise<{ text: string }>;
  generateJson: <T>() => Promise<T>;
};

const mockPrisma = prisma as any;

const mockProject = {
  id: 'proj-1',
  name: 'Industriverksamhet Gävle',
  organisationId: 'org-1',
};

const validGeminiResponse = JSON.stringify({
  applicationSummary: {
    title: 'Tillståndsansökan för Industriverksamhet',
    operationType: 'Miljöfarlig verksamhet',
    location: 'GÄVLE BRYNÄS 1:1',
    duration: '10 år',
    expectedEnvironmentalLoad: 'Medel',
    mainActivities: ['Avfallshantering', 'Lagring'],
  },
  riskAnalysis: [
    {
      category: 'ENVIRONMENTAL',
      riskName: 'Grundvattenförorening',
      description: 'Risk för läckage till grundvatten',
      severity: 'HIGH',
      mitigationMeasures: ['Tätskikt', 'Beredskapsplan'],
    },
  ],
  stakeholderAnalysis: [
    {
      name: 'Gävle Kommun',
      role: 'Tillsynsmyndighet',
      interestLevel: 'HIGH',
      powerLevel: 'HIGH',
      communicationNeeded: true,
    },
  ],
  requiredDocuments: [
    {
      documentType: 'Miljökonsekvensbeskrivning',
      description: 'MKB för verksamheten',
      mandatory: true,
    },
  ],
  budgetEstimate: {
    estimatedCost: 500000,
    currency: 'SEK',
    categories: {
      permittingFees: 50000,
      environmentalStudies: 200000,
      monitoring: 150000,
      contingency: 75000,
      other: 25000,
    },
  },
  environmentalImpact: {
    airQuality: 'Låg påverkan',
    waterQuality: 'Medel påverkan',
    soilContamination: 'Låg risk',
    noiseEmissions: 'Måttlig',
    biodiversity: 'Begränsad påverkan',
    climateGHG: '50 ton CO2e/år',
  },
  samplingAndLabPlan: [
    {
      parameter: 'Grundvatten pH',
      frequency: 'Kvartalsvis',
      location: 'GW-brunnar',
      method: 'Fältmätning',
      standardUsed: 'SS-EN ISO 10523',
      estimatedCost: 5000,
    },
  ],
  complianceChecklist: [
    {
      requirement: 'Tillståndsansökan inlämnad',
      relatedLaw: 'Miljöbalken 9 kap',
      status: 'DRAFT',
      notes: '',
    },
  ],
});

const validRequest: PermitApplicationRequest = {
  projectId: 'proj-1',
  propertyDesignation: 'GÄVLE BRYNÄS 1:1',
  sniCode: '38.21.10',
  description: 'Hantering av farligt avfall',
  budget: 500000,
  latitude: 60.67,
  longitude: 17.14,
};

describe('permitApplicationGeneratorService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.project.findUnique.mockResolvedValue(mockProject);
    mockGenerateContent.mockResolvedValue({ text: validGeminiResponse });
    testAiProvider = {
      generateText: async () => ({ text: validGeminiResponse }),
      generateJson: async () => JSON.parse(validGeminiResponse),
    };
    setAiProvider(testAiProvider);
  });

  describe('generatePermitApplication', () => {
    it('returnerar en komplett tillståndsansökan vid lyckad körning', async () => {
      const result = await generatePermitApplication(validRequest);

      expect(result.projectId).toBe('proj-1');
      expect(result.propertyDesignation).toBe('GÄVLE BRYNÄS 1:1');
      expect(result.sniCode).toBe('38.21.10');
      expect(result.generatedAt).toBeTruthy();
      expect(new Date(result.generatedAt).getTime()).toBeGreaterThan(0);
    });

    it('hämtar projekt från databasen', async () => {
      await generatePermitApplication(validRequest);
      expect(mockPrisma.project.findUnique).toHaveBeenCalledWith({
        where: { id: 'proj-1' },
      });
    });

    it('kastar fel om projektet inte hittas', async () => {
      mockPrisma.project.findUnique.mockResolvedValue(null);
      await expect(generatePermitApplication(validRequest)).rejects.toThrow('proj-1');
    });

    it('inkluderar ansökningssammanfattning', async () => {
      const result = await generatePermitApplication(validRequest);
      expect(result.applicationSummary.title).toBe('Tillståndsansökan för Industriverksamhet');
      expect(result.applicationSummary).not.toHaveProperty('currency');
    });

    it('inkluderar riskanalys med rätt struktur', async () => {
      const result = await generatePermitApplication(validRequest);
      expect(Array.isArray(result.riskAnalysis)).toBe(true);
      expect(result.riskAnalysis.length).toBeGreaterThan(0);
      const risk = result.riskAnalysis[0];
      expect(risk.id).toBe('risk-0');
      expect(risk.category).toBe('ENVIRONMENTAL');
      expect(risk.severity).toBe('HIGH');
    });

    it('inkluderar intressentanalys', async () => {
      const result = await generatePermitApplication(validRequest);
      expect(Array.isArray(result.stakeholderAnalysis)).toBe(true);
      const stakeholder = result.stakeholderAnalysis[0];
      expect(stakeholder.name).toBe('Gävle Kommun');
      expect(stakeholder.id).toBe('stakeholder-0');
    });

    it('inkluderar budgetestimat i SEK', async () => {
      const result = await generatePermitApplication(validRequest);
      expect(result.budgetEstimate.currency).toBe('SEK');
      expect(result.budgetEstimate.estimatedCost).toBe(500000);
    });

    it('inkluderar miljöpåverkansanalys', async () => {
      const result = await generatePermitApplication(validRequest);
      expect(result.environmentalImpact.airQuality).toBe('Låg påverkan');
      expect(result.environmentalImpact.waterQuality).toBe('Medel påverkan');
    });

    it('inkluderar källspårning med GEMINI_AI', async () => {
      const result = await generatePermitApplication(validRequest);
      const sources = result.sourceTracking.map((s) => s.source);
      expect(sources).toEqual(['GEMINI_AI']);
    });

    it('returnerar tom externSourcesUsed tills verifierade källor kopplas in', async () => {
      const result = await generatePermitApplication(validRequest);
      expect(Array.isArray(result.externalSourcesUsed)).toBe(true);
      expect(result.externalSourcesUsed).toEqual([]);
    });

    it('returnerar tom recommendedLaboratories tills laboratorieintegration är kopplad', async () => {
      const result = await generatePermitApplication(validRequest);
      expect(result.recommendedLaboratories).toEqual([]);
    });

    it('hanterar Gemini API-fel korrekt', async () => {
      setAiProvider({
        generateText: async () => {
          throw new Error('API-kvota överskriden');
        },
        generateJson: async () => {
          throw new Error('API-kvota överskriden');
        },
      });
      await expect(generatePermitApplication(validRequest)).rejects.toThrow(
        'Failed to generate permit application',
      );
    });

    it('hanterar ogiltig JSON från Gemini', async () => {
      setAiProvider({
        generateText: async () => ({ text: 'Detta är inte JSON' }),
        generateJson: async () => {
          throw new Error('No JSON object found');
        },
      });
      await expect(generatePermitApplication(validRequest)).rejects.toThrow();
    });

    it('kastar om latitude/longitude saknas (inga dolda standardkoordinater)', async () => {
      const requestWithoutCoords: PermitApplicationRequest = {
        projectId: 'proj-1',
        propertyDesignation: 'STOCKHOLM KUNGSHOLMEN 1:1',
        sniCode: '38.12.00',
        description: 'Icke-farligt avfall',
      };
      await expect(generatePermitApplication(requestWithoutCoords)).rejects.toThrow(
        'Verifierade koordinater krävs',
      );
    });

    it('hanterar känd SNI-kod (38.21.10)', async () => {
      const result = await generatePermitApplication(validRequest);
      expect(result.sniCode).toBe('38.21.10');
    });

    it('provtagningsplan har rätt ID-format', async () => {
      const result = await generatePermitApplication(validRequest);
      if (result.samplingAndLabPlan.length > 0) {
        expect(result.samplingAndLabPlan[0].id).toBe('sampling-0');
      }
    });

    it('efterlevnadschecklista har DRAFT-status som standard', async () => {
      const result = await generatePermitApplication(validRequest);
      if (result.complianceChecklist.length > 0) {
        expect(result.complianceChecklist[0].status).toBe('DRAFT');
        expect(result.complianceChecklist[0].id).toBe('compliance-0');
      }
    });
  });
});
