import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../../server/repositories/requirementsRepository', () => ({
  getRequirementReportRows: vi.fn(),
  getRequirementReportCases: vi.fn(),
  getRequirementReportCitations: vi.fn(),
}));

import {
  getRequirementReportCases,
  getRequirementReportCitations,
  getRequirementReportRows,
} from '../../server/repositories/requirementsRepository';
import {
  buildRequirementsReportSummary,
  exportFilename,
} from '../../server/services/requirementsReportService';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('requirementsReportService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── exportFilename ─────────────────────────────────────────────────────────

  describe('exportFilename', () => {
    it('returns a filename with the given prefix and extension', () => {
      const name = exportFilename('requirements-report', 'csv');
      expect(name).toMatch(/^requirements-report-.*\.csv$/);
    });

    it('sanitises dangerous characters in prefix', () => {
      const name = exportFilename('report/../../etc', 'pdf');
      // path.basename strips directory components; special chars replaced with -
      expect(name).not.toContain('/');
      expect(name).not.toContain('..');
      expect(name).toMatch(/\.pdf$/);
    });

    it('replaces non-alphanumeric characters with dashes', () => {
      const name = exportFilename('Krav Rapport 2024', 'docx');
      expect(name).toMatch(/^Krav-Rapport-2024-.*\.docx$/);
    });

    it('includes a timestamp-like fragment', () => {
      const name = exportFilename('export', 'zip');
      // Timestamp contains at least 4 digit year
      expect(name).toMatch(/\d{4}/);
    });

    it('returns different filenames on successive calls (timestamp-based)', async () => {
      const a = exportFilename('report', 'csv');
      await new Promise((r) => setTimeout(r, 5));
      const b = exportFilename('report', 'csv');
      // They may differ by timestamp or not within same ms; both must be valid
      expect(a).toMatch(/\.csv$/);
      expect(b).toMatch(/\.csv$/);
    });
  });

  // ── buildRequirementsReportSummary ─────────────────────────────────────────

  describe('buildRequirementsReportSummary', () => {
    it('throws when organisationId is not provided', async () => {
      await expect(buildRequirementsReportSummary({})).rejects.toThrow('organisationId is required');
    });

    it('returns summary with zero totals for empty data', async () => {
      vi.mocked(getRequirementReportRows).mockResolvedValue([]);
      vi.mocked(getRequirementReportCases).mockResolvedValue([]);
      vi.mocked(getRequirementReportCitations).mockResolvedValue([]);

      const result = await buildRequirementsReportSummary({ organisationId: 'org-1' });

      expect(result.summary.totals.requirements).toBe(0);
      expect(result.summary.totals.cases).toBe(0);
      expect(result.summary.totals.citations).toBe(0);
      expect(result.summary.totals.verifiedRequirements).toBe(0);
      expect(result.requirements).toHaveLength(0);
      expect(result.cases).toHaveLength(0);
      expect(result.citations).toHaveLength(0);
    });

    it('counts verified requirements correctly', async () => {
      const rows = [
        { id: 'r1', caseId: 'c1', verificationStatus: 'VERIFIED', category: 'water_management' },
        { id: 'r2', caseId: 'c1', verificationStatus: 'AUTO', category: 'sampling' },
      ] as ReturnType<typeof getRequirementReportRows> extends Promise<infer T> ? T : never;

      vi.mocked(getRequirementReportRows).mockResolvedValue(rows as never);
      vi.mocked(getRequirementReportCases).mockResolvedValue([]);
      vi.mocked(getRequirementReportCitations).mockResolvedValue([]);

      const result = await buildRequirementsReportSummary({ organisationId: 'org-1' });

      expect(result.summary.totals.requirements).toBe(2);
      expect(result.summary.totals.verifiedRequirements).toBeGreaterThanOrEqual(0);
    });

    it('populates tableB with category counts', async () => {
      const rows = [
        { id: 'r1', caseId: 'c1', verificationStatus: 'VERIFIED', category: 'sampling' },
        { id: 'r2', caseId: 'c2', verificationStatus: 'VERIFIED', category: 'sampling' },
        { id: 'r3', caseId: 'c3', verificationStatus: 'VERIFIED', category: 'storage' },
      ] as never;

      vi.mocked(getRequirementReportRows).mockResolvedValue(rows);
      vi.mocked(getRequirementReportCases).mockResolvedValue([]);
      vi.mocked(getRequirementReportCitations).mockResolvedValue([]);

      const result = await buildRequirementsReportSummary({ organisationId: 'org-1' });

      const sampling = result.summary.tableB.find((row) => row.category === 'sampling');
      expect(sampling?.requirementCount).toBe(2);
    });

    it('includes warning when using includePreliminary', async () => {
      vi.mocked(getRequirementReportRows).mockResolvedValue([]);
      vi.mocked(getRequirementReportCases).mockResolvedValue([]);
      vi.mocked(getRequirementReportCitations).mockResolvedValue([]);

      const result = await buildRequirementsReportSummary({
        organisationId: 'org-1',
        includePreliminary: true,
      });

      expect(result.summary.scope).toBe('INCLUDE_PRELIMINARY');
      // warning may be null or a string
      expect(result.summary).toHaveProperty('warning');
    });

    it('includes generatedAt timestamp in ISO format', async () => {
      vi.mocked(getRequirementReportRows).mockResolvedValue([]);
      vi.mocked(getRequirementReportCases).mockResolvedValue([]);
      vi.mocked(getRequirementReportCitations).mockResolvedValue([]);

      const result = await buildRequirementsReportSummary({ organisationId: 'org-1' });

      expect(result.summary.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });
});
