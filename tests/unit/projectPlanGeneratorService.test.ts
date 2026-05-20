import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGenerateContent = vi.fn();

vi.mock('../../server/services/vertexAiService', () => {
  return {
    generateTextWithVertex: vi.fn((prompt: string, opts?: unknown) => mockGenerateContent(prompt, opts)),
    generateJsonWithVertex: vi.fn(async () => null),
    vertexConfigStatus: vi.fn(() => ({
      configured: true,
      missing: [],
      projectId: 'test',
      location: 'europe-west1',
    })),
    __resetVertexClientForTest: vi.fn(),
  };
});

vi.mock('../../db.server', () => ({
  prisma: {
    project: { findUnique: vi.fn() },
  },
}));

import { prisma } from '../../db.server';
import { generateProjectPlan } from '../../server/services/projectPlanGeneratorService';
import type { ProjectPlanRequest } from '../../server/services/projectPlanGeneratorService';

const mockPrisma = prisma as any;

const mockProject = {
  id: 'proj-1',
  name: 'Marksanering Stockholm',
  organisationId: 'org-1',
};

const validPlanJson = JSON.stringify({
  phases: [
    {
      id: 'phase-1',
      name: 'Utredning',
      description: 'Geoteknisk undersökning',
      startDate: '2025-04-01',
      endDate: '2025-06-01',
      budget: 200_000,
      resources: ['Geotekniker', 'Miljökonsult'],
      predecessors: [],
    },
  ],
  risks: [
    {
      id: 'risk-1',
      name: 'Förorenade massor',
      description: 'Fukt kan sprida föroreningar',
      category: 'ENVIRONMENTAL',
      probability: 'MEDIUM',
      impact: 'HIGH',
      mitigation: 'Regelbunden provtagning',
      owner: 'Projektledare',
    },
  ],
  stakeholders: [
    {
      id: 'sh-1',
      name: 'Länsstyrelsen',
      role: 'Tillsynsmyndighet',
      interestLevel: 'HIGH',
      powerLevel: 'HIGH',
      communicationStrategy: 'Regelbundna rapporter',
      responsibilities: ['Tillsyn', 'Beslut'],
    },
  ],
  budget: {
    total: 1_500_000,
    currency: 'SEK',
    categories: {
      labor: 600_000,
      materials: 400_000,
      equipment: 300_000,
      contingency: 150_000,
      other: 50_000,
    },
    timeline: [{ quarter: 'Q2 2025', amount: 300_000 }],
  },
  samplingPlan: [],
  organizationStructure: {
    projectManager: 'Anna Lindqvist',
    teams: [{ name: 'Markmiljö', lead: 'Björn Eriksson', members: 3, responsibilities: ['Provtagning'] }],
  },
  geodataFindings: {
    waterBodies: ['Västra sjön (2.3 km)'],
    protectedNature: ['Naturreservat Ängslandet (1.5 km)'],
    soilTypes: ['Moränjord'],
    groundwaterRisk: 'MEDIUM',
    slopeStability: 'STABLE',
    proximity: { nearestWater: 800, nearestProtectedArea: 1500 },
  },
});

const baseRequest: ProjectPlanRequest = {
  projectId: 'proj-1',
  propertyId: 'STOCKHOLM VASASTADEN 1:1',
  projectType: 'REMEDIATION',
  budget: 1_500_000,
  timeframe: '12 months',
  description: 'Marksanering av industritomt i centrala Stockholm',
  latitude: 59.3293,
  longitude: 18.0686,
};

describe('projectPlanGeneratorService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('generateProjectPlan', () => {
    it('returnerar GeneratedProjectPlan med faser', async () => {
      mockPrisma.project.findUnique.mockResolvedValue(mockProject);
      mockGenerateContent.mockResolvedValue(validPlanJson);

      const result = await generateProjectPlan(baseRequest);

      expect(result.projectId).toBe('proj-1');
      expect(result.phases).toHaveLength(1);
      expect(result.phases[0].name).toBe('Utredning');
    });

    it('returnerar riskanalys och intressentanalys', async () => {
      mockPrisma.project.findUnique.mockResolvedValue(mockProject);
      mockGenerateContent.mockResolvedValue(validPlanJson);

      const result = await generateProjectPlan(baseRequest);

      expect(result.riskAnalysis).toHaveLength(1);
      expect(result.riskAnalysis[0].category).toBe('ENVIRONMENTAL');
      expect(result.stakeholderAnalysis[0].name).toBe('Länsstyrelsen');
    });

    it('kastar om projekt inte hittas', async () => {
      mockPrisma.project.findUnique.mockResolvedValue(null);

      await expect(generateProjectPlan(baseRequest)).rejects.toThrow('not found');
    });

    it('kastar vid Gemini-fel', async () => {
      mockPrisma.project.findUnique.mockResolvedValue(mockProject);
      mockGenerateContent.mockRejectedValue(new Error('API quota exceeded'));

      await expect(generateProjectPlan(baseRequest)).rejects.toThrow('Failed to generate project plan');
    });

    it('sätter externalSourcesUsed till tom lista tills verifierade källor kopplas', async () => {
      mockPrisma.project.findUnique.mockResolvedValue(mockProject);
      mockGenerateContent.mockResolvedValue(validPlanJson);

      const result = await generateProjectPlan(baseRequest);

      expect(result.externalSourcesUsed).toEqual([]);
    });

    it('innehåller generatedAt som ISO-sträng', async () => {
      mockPrisma.project.findUnique.mockResolvedValue(mockProject);
      mockGenerateContent.mockResolvedValue(validPlanJson);

      const result = await generateProjectPlan(baseRequest);
      expect(() => new Date(result.generatedAt)).not.toThrow();
    });

    it('tolkar JSON inbäddat i markdown kod-block', async () => {
      mockPrisma.project.findUnique.mockResolvedValue(mockProject);
      // Gemini sometimes wraps response in ```json ... ```
      const wrappedJson = `Här är din projektplan:\n\n\`\`\`json\n${validPlanJson}\n\`\`\`\n\nHoppas det hjälper!`;
      mockGenerateContent.mockResolvedValue(wrappedJson);

      const result = await generateProjectPlan(baseRequest);
      expect(result.phases).toHaveLength(1);
    });

    it('kastar om AI-svar inte är giltigt JSON', async () => {
      mockPrisma.project.findUnique.mockResolvedValue(mockProject);
      mockGenerateContent.mockResolvedValue('Tyvärr kan jag inte generera en plan just nu.');

      await expect(generateProjectPlan(baseRequest)).rejects.toThrow('Failed to generate project plan');
    });

    it('använder standardvärden för saknade fält i AI-svar', async () => {
      mockPrisma.project.findUnique.mockResolvedValue(mockProject);
      // Minimal JSON - missing most fields
      const minimalJson = JSON.stringify({
        phases: [{ name: 'Fas 1' }],
        risks: [{}],
        stakeholders: [],
        samplingPlan: [],
      });
      mockGenerateContent.mockResolvedValue(minimalJson);

      const result = await generateProjectPlan(baseRequest);
      expect(result.phases[0].budget).toBe(0);
      expect(result.riskAnalysis[0].category).toBe('OPERATIONAL');
      expect(result.riskAnalysis[0].probability).toBe('MEDIUM');
      expect(result.budget.currency).toBe('SEK');
      expect(result.organizationStructure.projectManager).toBe('Ej angiven');
    });

    it('kräver verifierade koordinater (ingen förtäckt standardposition)', async () => {
      mockPrisma.project.findUnique.mockResolvedValue(mockProject);
      mockGenerateContent.mockResolvedValue(validPlanJson);

      const requestWithoutCoords: ProjectPlanRequest = {
        projectId: 'proj-1',
        propertyId: 'STOCKHOLM VASASTADEN 1:1',
        projectType: 'ENV_PERMIT',
        budget: 500_000,
        timeframe: '6 months',
        description: 'Markundersökning',
      };

      await expect(generateProjectPlan(requestWithoutCoords)).rejects.toThrow(/koordinater krävs/i);
    });
  });
});
