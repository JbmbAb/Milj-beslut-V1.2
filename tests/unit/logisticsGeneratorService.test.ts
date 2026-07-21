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

import { prisma } from '../../db.server';
import { generateLogisticsPlan } from '../../server/services/logisticsGeneratorService';
import type { LogisticsGeneratorRequest } from '../../server/services/logisticsGeneratorService';

const mockPrisma = prisma as any;

const mockProject = {
  id: 'proj-1',
  name: 'Marksanering Gävle',
  organisationId: 'org-1',
};

const validJsonResponse = JSON.stringify({
  waybills: [
    {
      id: 'wb-1',
      wasteCode: '17 05 03',
      tons: 50,
      contaminants: ['PCB'],
      sourceAddress: 'Industrivägen 1, Gävle',
      destinationAddress: 'Gävle Avfallsanläggning',
      transportMode: 'TRUCK',
      pickupDate: '2025-04-01',
      deliveryDate: '2025-04-01',
      notes: 'Farligt gods',
    },
  ],
  drivingLog: [
    {
      id: 'dl-1',
      driverId: 'driver-1',
      startTime: '2025-04-01T08:00:00Z',
      endTime: '2025-04-01T10:00:00Z',
      route: 'Industrivägen → E4 → Deponin',
      distance: 15,
      fuelConsumed: 12,
      co2Emitted: 31.8,
      status: 'PLANNED',
    },
  ],
  depots: [],
  co2Calculation: {
    transportCo2kg: 31.8,
    storageCo2kg: 5,
    processingCo2kg: 2,
    totalCo2kg: 38.8,
    co2PerTon: 0.776,
    certificationStatus: 'ELIGIBLE',
  },
});

const baseRequest: LogisticsGeneratorRequest = {
  projectId: 'proj-1',
  wasteType: 'SOIL',
  estimatedTons: 50,
  sourceAddress: 'Industrivägen 1, Gävle',
  destinationAddress: 'Gävle Avfallsanläggning',
  transportMode: 'TRUCK',
  contaminants: ['PCB'],
};

describe('logisticsGeneratorService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('generateLogisticsPlan', () => {
    it('returnerar GeneratedLogisticsPlan med waybills', async () => {
      mockPrisma.project.findUnique.mockResolvedValue(mockProject);
      mockGenerateContent.mockResolvedValue(validJsonResponse);

      const result = await generateLogisticsPlan(baseRequest);

      expect(result.projectId).toBe('proj-1');
      expect(result.waybills).toHaveLength(1);
      expect(result.waybills[0].wasteCode).toBe('17 05 03');
    });

    it('kastar om projekt inte hittas', async () => {
      mockPrisma.project.findUnique.mockResolvedValue(null);

      await expect(generateLogisticsPlan(baseRequest)).rejects.toThrow('not found');
    });

    it('kastar vid Gemini API-fel', async () => {
      mockPrisma.project.findUnique.mockResolvedValue(mockProject);
      mockGenerateContent.mockRejectedValue(new Error('Rate limit exceeded'));

      await expect(generateLogisticsPlan(baseRequest)).rejects.toThrow('Failed to generate logistics plan');
    });

    it('innehåller CO2-beräkning', async () => {
      mockPrisma.project.findUnique.mockResolvedValue(mockProject);
      mockGenerateContent.mockResolvedValue(validJsonResponse);

      const result = await generateLogisticsPlan(baseRequest);

      expect(result.co2Calculation.totalCo2kg).toBe(38.8);
      expect(result.co2Calculation.certificationStatus).toBe('ELIGIBLE');
    });

    it('innehåller externa källor (externalSourcesUsed)', async () => {
      mockPrisma.project.findUnique.mockResolvedValue(mockProject);
      mockGenerateContent.mockResolvedValue(validJsonResponse);

      const result = await generateLogisticsPlan(baseRequest);

      expect(result.externalSourcesUsed).toContain('Trafikverket (vägnät, distanser)');
    });

    it('innehåller integrationer (Trafikverket, Avfallsregistret, Lantmäteriet)', async () => {
      mockPrisma.project.findUnique.mockResolvedValue(mockProject);
      mockGenerateContent.mockResolvedValue(validJsonResponse);

      const result = await generateLogisticsPlan(baseRequest);

      const names = result.integrationsAvailable.map((i) => i.name);
      expect(names).toContain('Trafikverket');
      expect(names).toContain('Avfallsregistret');
      expect(names).toContain('Lantmäteriet');
    });

    it('innehåller generatedAt som ISO-sträng', async () => {
      mockPrisma.project.findUnique.mockResolvedValue(mockProject);
      mockGenerateContent.mockResolvedValue(validJsonResponse);

      const result = await generateLogisticsPlan(baseRequest);
      expect(() => new Date(result.generatedAt)).not.toThrow();
    });
  });
});
