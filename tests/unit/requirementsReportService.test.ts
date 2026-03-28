import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  buildRequirementsReportSummary,
  buildRequirementsExportCsvZip,
  buildRequirementsDocxBuffer,
  exportFilename,
} from '../../server/services/requirementsReportService';
import * as repo from '../../server/repositories/requirementsRepository';

// Mock the repository
vi.mock('../../server/repositories/requirementsRepository', () => ({
  getRequirementReportRows: vi.fn(),
  getRequirementReportCases: vi.fn(),
  getRequirementReportCitations: vi.fn(),
}));

describe('requirementsReportService', () => {
  const organisationId = 'org-123';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('buildRequirementsReportSummary', () => {
    it('throws if organisationId is missing', async () => {
      await expect(buildRequirementsReportSummary({})).rejects.toThrow(/organisationId is required/);
    });

    it('generates summary for empty results', async () => {
      vi.mocked(repo.getRequirementReportRows).mockResolvedValue([]);
      vi.mocked(repo.getRequirementReportCases).mockResolvedValue([]);
      vi.mocked(repo.getRequirementReportCitations).mockResolvedValue([]);

      const result = await buildRequirementsReportSummary({ organisationId });

      expect(result.summary.totals.requirements).toBe(0);
      expect(result.summary.quality.municipalityCoveragePct).toBe(0);
      expect(result.summary.tableA).toHaveLength(0);
      expect(result.summary.warning).toBeNull();
    });

    it('handles preliminary requirements with warning', async () => {
      vi.mocked(repo.getRequirementReportRows).mockResolvedValue([
        { id: 'req-1', verificationStatus: 'AUTO', category: 'Ytkonstruktion' },
      ] as any);
      vi.mocked(repo.getRequirementReportCases).mockResolvedValue([]);
      vi.mocked(repo.getRequirementReportCitations).mockResolvedValue([]);

      const result = await buildRequirementsReportSummary({ organisationId, includePreliminary: true });

      expect(result.summary.warning).toContain('preliminara');
      expect(result.summary.scope).toBe('INCLUDE_PRELIMINARY');
    });

    it('populates tables A, B, C, D with sorted data', async () => {
      const mockRows = [
        {
          id: 'r1',
          caseId: 'c1',
          category: 'Ytkonstruktion',
          verificationStatus: 'VERIFIED',
          case: { municipality: 'M1' },
        },
        {
          id: 'r2',
          caseId: 'c1',
          category: 'DagvattenLakvatten',
          verificationStatus: 'VERIFIED',
          case: { municipality: 'M1' },
        },
        {
          id: 'r3',
          caseId: 'c2',
          category: 'Ytkonstruktion',
          verificationStatus: 'VERIFIED',
          case: { municipality: 'M2' },
          wasteType: 'WasteX',
          ewcCode: '123',
        },
      ];
      const mockCases = [
        { id: 'c1', authorityType: 'T1', authorityName: 'N1', documentType: 'D1', municipality: 'M1' },
        { id: 'c2', authorityType: 'T2', authorityName: 'N2', documentType: 'D2', municipality: 'M2' },
      ];

      vi.mocked(repo.getRequirementReportRows).mockResolvedValue(mockRows as any);
      vi.mocked(repo.getRequirementReportCases).mockResolvedValue(mockCases as any);
      vi.mocked(repo.getRequirementReportCitations).mockResolvedValue([]);

      const result = await buildRequirementsReportSummary({ organisationId });

      // Table A
      expect(result.summary.tableA).toHaveLength(2);
      expect(result.summary.tableA[0].caseCount).toBe(1);

      // Table B
      expect(result.summary.tableB).toHaveLength(2); // Ytkonstruktion, DagvattenLakvatten
      expect(result.summary.tableB.find((t) => t.category === 'Ytkonstruktion')?.requirementCount).toBe(2);

      // Table C
      expect(result.summary.tableC).toHaveLength(2);
      expect(result.summary.tableC.find((t) => t.municipality === 'M1')?.ytkonstruktion).toBe(1);
      expect(result.summary.tableC.find((t) => t.municipality === 'M1')?.dagvattenLakvatten).toBe(1);
      expect(result.summary.tableC.find((t) => t.municipality === 'M2')?.ytkonstruktion).toBe(1);
    });

    it('handles categories not in yt/dag in Table C', async () => {
      vi.mocked(repo.getRequirementReportRows).mockResolvedValue([
        { id: 'r1', category: 'Other', case: { municipality: 'M1' } },
        { id: 'r2', category: 'Ytkonstruktion', case: { municipality: 'M1' } },
      ] as any);
      vi.mocked(repo.getRequirementReportCases).mockResolvedValue([]);

      const result = await buildRequirementsReportSummary({ organisationId });
      expect(result.summary.tableC).toHaveLength(1); // Only M1 because of Ytkonstruktion
      expect(result.summary.tableC[0].ytkonstruktion).toBe(1);
    });
  });

  describe('Formatting Helpers', () => {
    it('covers toTableRows maxRows limit', async () => {
      // We can't easily call toTableRows directly as it's not exported,
      // but we can trigger it via buildRequirementsDocxBuffer if we have many rows.
      const mockRows = Array.from({ length: 30 }, (_, i) => ({
        category: `Cat${i}`,
        requirementCount: 1,
      }));

      vi.mocked(repo.getRequirementReportRows).mockResolvedValue(mockRows as any);
      vi.mocked(repo.getRequirementReportCases).mockResolvedValue([]);

      const buffer = await buildRequirementsDocxBuffer({ organisationId });
      expect(buffer).toBeDefined();
    });

    it('handles missing fields in export mapping', async () => {
      const mockCases = [{ id: 'c1', documentDate: null, validatedAt: null }];
      const mockReqs = [{ id: 'r1', case: null }];

      vi.mocked(repo.getRequirementReportRows).mockResolvedValue(mockReqs as any);
      vi.mocked(repo.getRequirementReportCases).mockResolvedValue(mockCases as any);

      const stream = await buildRequirementsExportCsvZip({ organisationId });
      expect(stream).toBeDefined();
    });
  });

  describe('CSV and ZIP exports', () => {
    it('generates a zip stream with all expected files', async () => {
      vi.mocked(repo.getRequirementReportRows).mockResolvedValue([]);
      vi.mocked(repo.getRequirementReportCases).mockResolvedValue([]);
      vi.mocked(repo.getRequirementReportCitations).mockResolvedValue([]);

      const stream = await buildRequirementsExportCsvZip({ organisationId });
      expect(stream).toBeDefined();
      // We don't verify full ZIP binary content here, but we covered the lines
    });

    it('covers CSV cell escaping with special characters', async () => {
      const mockRows = [
        {
          id: 'r1',
          category: 'Cat;With;Semicolon',
          requirementTextQuote: 'Quote with "double quotes"',
          case: { caseKey: 'C1' },
        },
      ];
      vi.mocked(repo.getRequirementReportRows).mockResolvedValue(mockRows as any);
      vi.mocked(repo.getRequirementReportCases).mockResolvedValue([]);
      vi.mocked(repo.getRequirementReportCitations).mockResolvedValue([]);

      // This will trigger csvFromRows and toCsvCell
      const stream = await buildRequirementsExportCsvZip({ organisationId });
      expect(stream).toBeDefined();
    });
  });

  describe('DOCX exports', () => {
    it('generates a docx buffer', async () => {
      vi.mocked(repo.getRequirementReportRows).mockResolvedValue([]);
      vi.mocked(repo.getRequirementReportCases).mockResolvedValue([]);
      vi.mocked(repo.getRequirementReportCitations).mockResolvedValue([]);

      const buffer = await buildRequirementsDocxBuffer({ organisationId });
      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(0);
    });
  });

  describe('exportFilename', () => {
    it('sanitizes prefix and adds extension', () => {
      const name = exportFilename('My Report! @123', 'csv');
      expect(name).toMatch(/^My-Report---123-.*\.csv$/);
    });
  });
});
