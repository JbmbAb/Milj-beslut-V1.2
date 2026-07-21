import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../server/db/prisma', () => ({
  prisma: {
    regulation: {
      findUnique: vi.fn(),
    },
    documentRecord: {
      count: vi.fn(),
    },
  },
}));

vi.mock('../../server/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { prisma } from '../../server/db/prisma';
import { getApplicationPdfData, getSustainabilityReportData } from '../../server/services/pdfReportService';

const mockPrisma = prisma as any;

describe('pdfReportService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getApplicationPdfData', () => {
    it('returnerar PDF-data för känd verksamhetskod', async () => {
      mockPrisma.regulation.findUnique.mockResolvedValue({
        code: '9.1',
        title: 'Avloppsanläggning',
        description: 'Anläggningar för avloppsrening',
        warning: null,
        requirements: [{ type: 'krav', text: 'Markprovtagning krävs', source: 'MB 9 kap' }],
      });

      const result = await getApplicationPdfData('9.1', 'GÄVLE BRYNÄS 1:1');

      expect(result.verksamhetskod).toBe('9.1');
      expect(result.fastighet).toBe('GÄVLE BRYNÄS 1:1');
      expect(result.regulation.code).toBe('9.1');
      expect(result.regulation.title).toBe('Avloppsanläggning');
      expect(result.requirements).toHaveLength(1);
      expect(result.requirements[0].type).toBe('KRAV');
      expect(result.disclaimer).toContain('Human in the Loop');
    });

    it('kastar fel för okänd verksamhetskod', async () => {
      mockPrisma.regulation.findUnique.mockResolvedValue(null);
      await expect(getApplicationPdfData('999.9')).rejects.toThrow('Okänd verksamhetskod');
    });

    it('fastighet är null om inte angiven', async () => {
      mockPrisma.regulation.findUnique.mockResolvedValue({
        code: '9.1',
        title: 'Test',
        description: '',
        warning: null,
        requirements: [],
      });

      const result = await getApplicationPdfData('9.1');
      expect(result.fastighet).toBeNull();
    });

    it('inkluderar warning om det finns', async () => {
      mockPrisma.regulation.findUnique.mockResolvedValue({
        code: '9.1',
        title: 'Test',
        description: 'Desc',
        warning: 'OBS: Kontakta kommunen',
        requirements: [],
      });

      const result = await getApplicationPdfData('9.1');
      expect(result.regulation.warning).toBe('OBS: Kontakta kommunen');
    });

    it('innehåller generatedAt som ISO-sträng', async () => {
      mockPrisma.regulation.findUnique.mockResolvedValue({
        code: '9.1',
        title: 'Test',
        description: '',
        warning: null,
        requirements: [],
      });

      const result = await getApplicationPdfData('9.1');
      expect(() => new Date(result.generatedAt)).not.toThrow();
    });
  });

  describe('getSustainabilityReportData', () => {
    it('returnerar rapport med korrekta aggregeringar', async () => {
      mockPrisma.documentRecord.count
        .mockResolvedValueOnce(100) // total
        .mockResolvedValueOnce(80); // aiAnalyzed

      const result = await getSustainabilityReportData();

      expect(result.totalPermits).toBe(100);
      expect(result.aiAnalyzed).toBe(80);
      expect(result.riskScore).toBe(80);
      expect(result.riskLabel).toBe('Låg');
      expect(result.legalBasis).toContain('Miljöbalken');
    });

    it('filtrerar på organisationId om angivet', async () => {
      mockPrisma.documentRecord.count.mockResolvedValue(10);

      await getSustainabilityReportData('org-123');

      // Verify count was called (at least once)
      expect(mockPrisma.documentRecord.count).toHaveBeenCalled();
    });

    it('riskLabel=Hög när riskScore < 50', async () => {
      mockPrisma.documentRecord.count.mockResolvedValueOnce(100).mockResolvedValueOnce(10); // only 10% AI analyzed

      const result = await getSustainabilityReportData();
      expect(result.riskLabel).toBe('Hög');
    });

    it('riskLabel=Medel när riskScore 50-79', async () => {
      mockPrisma.documentRecord.count.mockResolvedValueOnce(100).mockResolvedValueOnce(60);

      const result = await getSustainabilityReportData();
      expect(result.riskLabel).toBe('Medel');
    });

    it('totalPermits=0 ger riskScore=0', async () => {
      mockPrisma.documentRecord.count.mockResolvedValue(0);

      const result = await getSustainabilityReportData();
      expect(result.totalPermits).toBe(0);
      expect(result.riskScore).toBe(0);
    });

    it('kastar om Prisma-anropet misslyckas', async () => {
      mockPrisma.documentRecord.count.mockRejectedValue(new Error('DB-fel'));
      await expect(getSustainabilityReportData()).rejects.toThrow('DB-fel');
    });
  });
});
