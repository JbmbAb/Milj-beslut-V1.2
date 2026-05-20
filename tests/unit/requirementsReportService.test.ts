import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  getRequirementReportRows: vi.fn(),
  getRequirementReportCases: vi.fn(),
  getRequirementReportCitations: vi.fn(),
}));

vi.mock('../../server/repositories/requirementsRepository', () => ({
  getRequirementReportRows: mocks.getRequirementReportRows,
  getRequirementReportCases: mocks.getRequirementReportCases,
  getRequirementReportCitations: mocks.getRequirementReportCitations,
}));

import {
  buildRequirementsReportSummary,
  buildRequirementsExportCsvZip,
  buildRequirementsDocxBuffer,
  exportFilename,
} from '../../server/services/requirementsReportService';

const BASE_REQUIREMENT = {
  id: 'req-1',
  requirementCode: 'REQ-001',
  caseId: 'case-1',
  documentId: 'doc-1',
  projectId: 'proj-1',
  organisationId: 'org-1',
  category: 'Ytkonstruktion',
  subcategory: 'Provtagning',
  level: 'mandatory',
  requirementTextQuote: 'Test quote',
  interpretedRequirement: 'Test interpretation',
  legalReference: 'Miljöbalken',
  wasteType: 'Farligt avfall',
  ewcCode: '17 05 03*',
  verificationStatus: 'VERIFIED',
  verifiedBy: 'user@example.com',
  verifiedAt: new Date('2024-01-01'),
  validationComment: '',
  case: { caseKey: 'CASE-001', municipality: 'Stockholm' },
};

const BASE_CASE = {
  id: 'case-1',
  caseKey: 'CASE-001',
  documentId: 'doc-1',
  projectId: 'proj-1',
  organisationId: 'org-1',
  municipality: 'Stockholm',
  authorityType: 'Länsstyrelse',
  authorityName: 'Länsstyrelsen Stockholm',
  diarienummer: '123-2024',
  documentType: 'Beslut',
  documentDate: new Date('2024-01-01'),
  sourceFile: 'beslut.pdf',
  sourceSubject: 'Miljöbeslut',
  reviewStatus: 'REVIEWED',
  validatedBy: 'user@example.com',
  validatedAt: new Date('2024-01-01'),
  notes: '',
};

const BASE_CITATION = {
  id: 'cit-1',
  citationCode: 'CIT-001',
  requirementId: 'req-1',
  caseId: 'case-1',
  documentId: 'doc-1',
  quoteText: 'Cited text',
  pageNumber: 5,
  charStart: 100,
  charEnd: 200,
  verificationStatus: 'VERIFIED',
  verifiedBy: 'user@example.com',
  verifiedAt: new Date('2024-01-01'),
  comment: '',
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getRequirementReportRows.mockResolvedValue([BASE_REQUIREMENT]);
  mocks.getRequirementReportCases.mockResolvedValue([BASE_CASE]);
  mocks.getRequirementReportCitations.mockResolvedValue([BASE_CITATION]);
});

describe('buildRequirementsReportSummary', () => {
  it('throws if organisationId is missing', async () => {
    await expect(buildRequirementsReportSummary({})).rejects.toThrow('organisationId is required');
  });

  it('returns summary with correct totals for verified-only scope', async () => {
    const { summary } = await buildRequirementsReportSummary({
      organisationId: 'org-1',
    });

    expect(summary.scope).toBe('VERIFIED_ONLY');
    expect(summary.warning).toBeNull();
    expect(summary.totals.requirements).toBe(1);
    expect(summary.totals.cases).toBe(1);
    expect(summary.totals.citations).toBe(1);
    expect(summary.totals.verifiedRequirements).toBe(1);
    expect(summary.totals.excludedRequirements).toBe(0);
  });

  it('sets scope and warning when includePreliminary is true', async () => {
    const { summary } = await buildRequirementsReportSummary({
      organisationId: 'org-1',
      includePreliminary: true,
    });

    expect(summary.scope).toBe('INCLUDE_PRELIMINARY');
    expect(summary.warning).toMatch(/preliminara/i);
    expect(summary.totals.excludedRequirements).toBe(0);
  });

  it('builds tableA from cases grouped by authority/documentType', async () => {
    const { summary } = await buildRequirementsReportSummary({
      organisationId: 'org-1',
    });

    expect(summary.tableA).toHaveLength(1);
    expect(summary.tableA[0]).toMatchObject({
      authorityType: 'Länsstyrelse',
      authorityName: 'Länsstyrelsen Stockholm',
      documentType: 'Beslut',
      caseCount: 1,
    });
  });

  it('builds tableB from requirements grouped by category', async () => {
    const { summary } = await buildRequirementsReportSummary({
      organisationId: 'org-1',
    });

    expect(summary.tableB).toHaveLength(1);
    expect(summary.tableB[0]).toMatchObject({
      category: 'Ytkonstruktion',
      requirementCount: 1,
    });
  });

  it('builds tableC with ytkonstruktion count for municipalities', async () => {
    const { summary } = await buildRequirementsReportSummary({
      organisationId: 'org-1',
    });

    expect(summary.tableC).toHaveLength(1);
    expect(summary.tableC[0]).toMatchObject({
      municipality: 'Stockholm',
      ytkonstruktion: 1,
      dagvattenLakvatten: 0,
    });
  });

  it('builds tableD from requirements grouped by wasteType/ewcCode', async () => {
    const { summary } = await buildRequirementsReportSummary({
      organisationId: 'org-1',
    });

    expect(summary.tableD).toHaveLength(1);
    expect(summary.tableD[0]).toMatchObject({
      wasteType: 'Farligt avfall',
      ewcCode: '17 05 03*',
      requirementCount: 1,
    });
  });

  it('computes quality coverage percentages', async () => {
    const { summary } = await buildRequirementsReportSummary({
      organisationId: 'org-1',
    });

    expect(summary.quality.municipalityCoveragePct).toBe(100);
    expect(summary.quality.authorityCoveragePct).toBe(100);
    expect(summary.quality.verifiedRequirementsPct).toBe(100);
    expect(summary.quality.rejectedRequirements).toBe(0);
  });

  it('uses "Okand" fallback for missing category fields', async () => {
    mocks.getRequirementReportRows.mockResolvedValue([
      { ...BASE_REQUIREMENT, category: '', wasteType: '', ewcCode: '', case: null },
    ]);

    const { summary } = await buildRequirementsReportSummary({
      organisationId: 'org-1',
    });

    expect(summary.tableB[0].category).toBe('Okand');
    expect(summary.tableD[0].wasteType).toBe('Okand');
  });

  it('handles zero cases gracefully (no division by zero)', async () => {
    mocks.getRequirementReportCases.mockResolvedValue([]);

    const { summary } = await buildRequirementsReportSummary({
      organisationId: 'org-1',
    });

    expect(summary.quality.municipalityCoveragePct).toBe(0);
    expect(summary.quality.authorityCoveragePct).toBe(0);
  });

  it('returns requirements, cases, citations in result', async () => {
    const result = await buildRequirementsReportSummary({ organisationId: 'org-1' });

    expect(result.requirements).toHaveLength(1);
    expect(result.cases).toHaveLength(1);
    expect(result.citations).toHaveLength(1);
  });

  it('passes projectId to repository calls when provided', async () => {
    await buildRequirementsReportSummary({ organisationId: 'org-1', projectId: 'proj-42' });

    expect(mocks.getRequirementReportRows).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'proj-42' }),
    );
  });
});

describe('buildRequirementsExportCsvZip', () => {
  it('returns a readable stream', async () => {
    const stream = await buildRequirementsExportCsvZip({ organisationId: 'org-1' });

    expect(stream).toBeDefined();
    expect(typeof stream.pipe).toBe('function');
  });
});

describe('buildRequirementsDocxBuffer', () => {
  it('returns a Buffer', async () => {
    const buf = await buildRequirementsDocxBuffer({ organisationId: 'org-1' });

    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(0);
  });
});

describe('exportFilename', () => {
  it('includes the sanitised prefix and extension', () => {
    const name = exportFilename('my-report', 'zip');
    expect(name).toMatch(/^my-report-.*\.zip$/);
  });

  it('strips path separators from prefix', () => {
    const name = exportFilename('path/to/file', 'csv');
    expect(name).toMatch(/^file-.*\.csv$/);
  });

  it('replaces illegal characters in prefix', () => {
    const name = exportFilename('report name!', 'docx');
    expect(name).toMatch(/^report-name--.*\.docx$/);
  });
});
