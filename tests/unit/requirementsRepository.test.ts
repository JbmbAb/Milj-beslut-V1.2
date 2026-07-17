import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requirementCaseCount: vi.fn(),
  requirementCaseFindMany: vi.fn(),
  requirementCaseUpdate: vi.fn(),
  requirementCaseFindFirst: vi.fn(),
  requirementRecordCount: vi.fn(),
  requirementRecordFindMany: vi.fn(),
  requirementRecordFindFirst: vi.fn(),
  requirementRecordUpdate: vi.fn(),
  requirementCitationCount: vi.fn(),
  requirementCitationFindMany: vi.fn(),
  requirementCitationFindFirst: vi.fn(),
  requirementCitationUpdate: vi.fn(),
  documentRecordFindFirst: vi.fn(),
}));

vi.mock('../../server/db/prisma', () => ({
  prisma: {
    requirementCase: {
      count: mocks.requirementCaseCount,
      findMany: mocks.requirementCaseFindMany,
      findFirst: mocks.requirementCaseFindFirst,
      update: mocks.requirementCaseUpdate,
    },
    requirementRecord: {
      count: mocks.requirementRecordCount,
      findMany: mocks.requirementRecordFindMany,
      findFirst: mocks.requirementRecordFindFirst,
      update: mocks.requirementRecordUpdate,
    },
    requirementCitation: {
      count: mocks.requirementCitationCount,
      findMany: mocks.requirementCitationFindMany,
      findFirst: mocks.requirementCitationFindFirst,
      update: mocks.requirementCitationUpdate,
    },
    documentRecord: {
      findFirst: mocks.documentRecordFindFirst,
    },
  },
}));

import {
  listRequirementCases,
  listRequirementRows,
  listRequirementCitations,
  getRequirementByCode,
  getCitationByCode,
  getRequirementCaseById,
  updateRequirementCaseReview,
  updateRequirementVerification,
  updateCitationVerification,
  getDocumentById,
  getRequirementReportRows,
  getRequirementReportCases,
  getRequirementReportCitations,
} from '../../server/repositories/requirementsRepository';

const ORG = 'org-1';

// ---------------------------------------------------------------------------
// listRequirementCases
// ---------------------------------------------------------------------------
describe('listRequirementCases', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns paginated cases filtered by organisationId', async () => {
    mocks.requirementCaseCount.mockResolvedValue(3);
    mocks.requirementCaseFindMany.mockResolvedValue([{ id: 'c1' }, { id: 'c2' }]);

    const result = await listRequirementCases({ organisationId: ORG, page: 1, pageSize: 2 });

    expect(result.total).toBe(3);
    expect(result.items).toHaveLength(2);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(2);

    const whereArg = mocks.requirementCaseFindMany.mock.calls[0][0].where;
    expect(whereArg.organisationId).toBe(ORG);
  });

  it('applies municipality filter case-insensitively', async () => {
    mocks.requirementCaseCount.mockResolvedValue(0);
    mocks.requirementCaseFindMany.mockResolvedValue([]);

    await listRequirementCases({ organisationId: ORG, municipality: 'Stockholm' });

    const where = mocks.requirementCaseFindMany.mock.calls[0][0].where;
    expect(where.municipality).toEqual({ contains: 'Stockholm', mode: 'insensitive' });
  });

  it('applies documentType filter', async () => {
    mocks.requirementCaseCount.mockResolvedValue(0);
    mocks.requirementCaseFindMany.mockResolvedValue([]);

    await listRequirementCases({ organisationId: ORG, documentType: 'PDF' });

    const where = mocks.requirementCaseFindMany.mock.calls[0][0].where;
    expect(where.documentType).toBe('PDF');
  });

  it('applies optional projectId filter', async () => {
    mocks.requirementCaseCount.mockResolvedValue(0);
    mocks.requirementCaseFindMany.mockResolvedValue([]);

    await listRequirementCases({ organisationId: ORG, projectId: 'proj-1' });

    const where = mocks.requirementCaseFindMany.mock.calls[0][0].where;
    expect(where.projectId).toBe('proj-1');
  });

  it('uses default pagination when not provided', async () => {
    mocks.requirementCaseCount.mockResolvedValue(0);
    mocks.requirementCaseFindMany.mockResolvedValue([]);

    const result = await listRequirementCases({ organisationId: ORG });

    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(25);
  });
});

// ---------------------------------------------------------------------------
// listRequirementRows
// ---------------------------------------------------------------------------
describe('listRequirementRows', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns paginated rows with organisationId enforced via project', async () => {
    mocks.requirementRecordCount.mockResolvedValue(5);
    mocks.requirementRecordFindMany.mockResolvedValue([{ id: 'r1' }]);

    const result = await listRequirementRows({ organisationId: ORG });

    expect(result.total).toBe(5);
    const where = mocks.requirementRecordFindMany.mock.calls[0][0].where;
    expect(where.project).toEqual({ organisationId: ORG });
  });

  it('defaults to VERIFIED status when includePreliminary is false and no verificationStatus given', async () => {
    mocks.requirementRecordCount.mockResolvedValue(0);
    mocks.requirementRecordFindMany.mockResolvedValue([]);

    await listRequirementRows({ organisationId: ORG, includePreliminary: false });

    const where = mocks.requirementRecordFindMany.mock.calls[0][0].where;
    expect(where.verificationStatus).toBe('VERIFIED');
  });

  it('does NOT restrict verificationStatus when includePreliminary is true', async () => {
    mocks.requirementRecordCount.mockResolvedValue(0);
    mocks.requirementRecordFindMany.mockResolvedValue([]);

    await listRequirementRows({ organisationId: ORG, includePreliminary: true });

    const where = mocks.requirementRecordFindMany.mock.calls[0][0].where;
    expect(where.verificationStatus).toBeUndefined();
  });

  it('applies an explicit verificationStatus filter', async () => {
    mocks.requirementRecordCount.mockResolvedValue(0);
    mocks.requirementRecordFindMany.mockResolvedValue([]);

    await listRequirementRows({ organisationId: ORG, verificationStatus: 'REVIEWED' });

    const where = mocks.requirementRecordFindMany.mock.calls[0][0].where;
    expect(where.verificationStatus).toBe('REVIEWED');
  });
});

// ---------------------------------------------------------------------------
// listRequirementCitations
// ---------------------------------------------------------------------------
describe('listRequirementCitations', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns paginated citations with organisationId enforced via requirement->project', async () => {
    mocks.requirementCitationCount.mockResolvedValue(2);
    mocks.requirementCitationFindMany.mockResolvedValue([{ id: 'cit-1' }]);

    const result = await listRequirementCitations({ organisationId: ORG });

    expect(result.total).toBe(2);
    const where = mocks.requirementCitationFindMany.mock.calls[0][0].where;
    expect(where.requirement).toMatchObject({ project: { organisationId: ORG } });
  });
});

// ---------------------------------------------------------------------------
// getRequirementByCode / getCitationByCode / getRequirementCaseById
// ---------------------------------------------------------------------------
describe('getRequirementByCode', () => {
  beforeEach(() => vi.resetAllMocks());

  it('queries by requirementCode and organisationId via project', async () => {
    mocks.requirementRecordFindFirst.mockResolvedValue({ id: 'r1', requirementCode: 'REQ-001' });

    const result = await getRequirementByCode('REQ-001', ORG);

    expect(result).toEqual({ id: 'r1', requirementCode: 'REQ-001' });
    expect(mocks.requirementRecordFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { requirementCode: 'REQ-001', project: { organisationId: ORG } },
      }),
    );
  });

  it('returns null when not found', async () => {
    mocks.requirementRecordFindFirst.mockResolvedValue(null);
    expect(await getRequirementByCode('MISSING', ORG)).toBeNull();
  });
});

describe('getCitationByCode', () => {
  beforeEach(() => vi.resetAllMocks());

  it('queries by citationCode and organisationId via requirement->project', async () => {
    mocks.requirementCitationFindFirst.mockResolvedValue({ id: 'cit-1' });

    const result = await getCitationByCode('CIT-001', ORG);

    expect(result).toEqual({ id: 'cit-1' });
    expect(mocks.requirementCitationFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          citationCode: 'CIT-001',
          requirement: { project: { organisationId: ORG } },
        },
      }),
    );
  });
});

describe('getRequirementCaseById', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns the case when found', async () => {
    mocks.requirementCaseFindFirst.mockResolvedValue({ id: 'case-1' });

    const result = await getRequirementCaseById('case-1', ORG);

    expect(result).toEqual({ id: 'case-1' });
    expect(mocks.requirementCaseFindFirst).toHaveBeenCalledWith({
      where: { id: 'case-1', organisationId: ORG },
    });
  });
});

// ---------------------------------------------------------------------------
// updateRequirementCaseReview
// ---------------------------------------------------------------------------
describe('updateRequirementCaseReview', () => {
  beforeEach(() => vi.resetAllMocks());

  it('updates the case review with AUTO status (no validatedBy required)', async () => {
    mocks.requirementCaseFindFirst.mockResolvedValue({ id: 'case-1' });
    mocks.requirementCaseUpdate.mockResolvedValue({ id: 'case-1', caseReviewStatus: 'AUTO' });

    const result = await updateRequirementCaseReview({
      caseId: 'case-1',
      organisationId: ORG,
      caseReviewStatus: 'AUTO',
    });

    expect(result.caseReviewStatus).toBe('AUTO');
    const updateData = mocks.requirementCaseUpdate.mock.calls[0][0].data;
    expect(updateData.caseReviewStatus).toBe('AUTO');
    expect(updateData.reviewStatus).toBe('AUTO');
    expect(updateData.validatedAt).toBeNull();
  });

  it('updates the case review with VERIFIED status', async () => {
    mocks.requirementCaseFindFirst.mockResolvedValue({ id: 'case-1' });
    mocks.requirementCaseUpdate.mockResolvedValue({ id: 'case-1', caseReviewStatus: 'VERIFIED' });

    await updateRequirementCaseReview({
      caseId: 'case-1',
      organisationId: ORG,
      caseReviewStatus: 'VERIFIED',
      validatedBy: 'user@example.com',
    });

    const updateData = mocks.requirementCaseUpdate.mock.calls[0][0].data;
    expect(updateData.caseReviewStatus).toBe('VERIFIED');
    expect(updateData.reviewStatus).toBe('VERIFIED');
    expect(updateData.validatedBy).toBe('user@example.com');
  });

  it('throws when case is not found', async () => {
    mocks.requirementCaseFindFirst.mockResolvedValue(null);

    await expect(
      updateRequirementCaseReview({
        caseId: 'missing',
        organisationId: ORG,
        caseReviewStatus: 'AUTO',
      }),
    ).rejects.toThrow('Requirement case not found');
  });

  it('throws when non-AUTO status is used without validatedBy', async () => {
    mocks.requirementCaseFindFirst.mockResolvedValue({ id: 'case-1' });

    await expect(
      updateRequirementCaseReview({
        caseId: 'case-1',
        organisationId: ORG,
        caseReviewStatus: 'VERIFIED',
        validatedBy: '',
      }),
    ).rejects.toThrow('validatedBy is required');
  });
});

// ---------------------------------------------------------------------------
// updateRequirementVerification
// ---------------------------------------------------------------------------
describe('updateRequirementVerification', () => {
  beforeEach(() => vi.resetAllMocks());

  it('updates with AUTO status without requiring verifiedBy', async () => {
    mocks.requirementRecordFindFirst.mockResolvedValue({
      id: 'r1',
      citations: [],
    });
    mocks.requirementRecordUpdate.mockResolvedValue({ id: 'r1', verificationStatus: 'AUTO' });

    const result = await updateRequirementVerification({
      requirementCode: 'REQ-001',
      organisationId: ORG,
      verificationStatus: 'AUTO',
    });

    expect(result.verificationStatus).toBe('AUTO');
  });

  it('throws when requirement is not found', async () => {
    mocks.requirementRecordFindFirst.mockResolvedValue(null);

    await expect(
      updateRequirementVerification({
        requirementCode: 'MISSING',
        organisationId: ORG,
        verificationStatus: 'AUTO',
      }),
    ).rejects.toThrow('Requirement not found');
  });

  it('throws when VERIFIED status is set without verifiedBy', async () => {
    mocks.requirementRecordFindFirst.mockResolvedValue({ id: 'r1', citations: [] });

    await expect(
      updateRequirementVerification({
        requirementCode: 'REQ-001',
        organisationId: ORG,
        verificationStatus: 'VERIFIED',
        verifiedBy: '',
      }),
    ).rejects.toThrow('verifiedBy is required');
  });

  it('throws when VERIFIED status is set and citations are not all reviewed/verified', async () => {
    mocks.requirementRecordFindFirst.mockResolvedValue({
      id: 'r1',
      citations: [{ verificationStatus: 'AUTO' }],
    });

    await expect(
      updateRequirementVerification({
        requirementCode: 'REQ-001',
        organisationId: ORG,
        verificationStatus: 'VERIFIED',
        verifiedBy: 'reviewer@example.com',
      }),
    ).rejects.toThrow('All citations must be REVIEWED or VERIFIED');
  });

  it('throws on invalid lifecycle transition (VERIFIED -> AUTO)', async () => {
    mocks.requirementRecordFindFirst.mockResolvedValue({
      id: 'r1',
      citations: [{ verificationStatus: 'REVIEWED' }],
      verificationStatus: 'VERIFIED',
      case: { caseReviewStatus: 'AUTO' },
    });

    await expect(
      updateRequirementVerification({
        requirementCode: 'REQ-001',
        organisationId: ORG,
        verificationStatus: 'AUTO',
        actorKind: 'user',
      }),
    ).rejects.toThrow(/REQUIREMENT_INVALID_TRANSITION/);
  });

  it('throws when case is LOCKED and actor is not system', async () => {
    mocks.requirementRecordFindFirst.mockResolvedValue({
      id: 'r1',
      citations: [{ verificationStatus: 'REVIEWED' }],
      verificationStatus: 'REVIEWED',
      case: { caseReviewStatus: 'LOCKED' },
    });

    await expect(
      updateRequirementVerification({
        requirementCode: 'REQ-001',
        organisationId: ORG,
        verificationStatus: 'VERIFIED',
        verifiedBy: 'reviewer@example.com',
        actorKind: 'user',
      }),
    ).rejects.toThrow(/REQUIREMENT_LOCKED/);
  });

  it('succeeds when VERIFIED and all citations are REVIEWED', async () => {
    mocks.requirementRecordFindFirst.mockResolvedValue({
      id: 'r1',
      citations: [{ verificationStatus: 'REVIEWED' }, { verificationStatus: 'VERIFIED' }],
    });
    mocks.requirementRecordUpdate.mockResolvedValue({ id: 'r1', verificationStatus: 'VERIFIED' });

    const result = await updateRequirementVerification({
      requirementCode: 'REQ-001',
      organisationId: ORG,
      verificationStatus: 'VERIFIED',
      verifiedBy: 'reviewer@example.com',
    });

    expect(result.verificationStatus).toBe('VERIFIED');
  });
});

// ---------------------------------------------------------------------------
// updateCitationVerification
// ---------------------------------------------------------------------------
describe('updateCitationVerification', () => {
  beforeEach(() => vi.resetAllMocks());

  it('updates citation with AUTO status', async () => {
    mocks.requirementCitationFindFirst.mockResolvedValue({ id: 'cit-1', pageNumber: null, comment: null });
    mocks.requirementCitationUpdate.mockResolvedValue({ id: 'cit-1', verificationStatus: 'AUTO' });

    const result = await updateCitationVerification({
      citationCode: 'CIT-001',
      organisationId: ORG,
      verificationStatus: 'AUTO',
    });

    expect(result.verificationStatus).toBe('AUTO');
  });

  it('throws when citation is not found', async () => {
    mocks.requirementCitationFindFirst.mockResolvedValue(null);

    await expect(
      updateCitationVerification({
        citationCode: 'MISSING',
        organisationId: ORG,
        verificationStatus: 'AUTO',
      }),
    ).rejects.toThrow('Citation not found');
  });

  it('throws when VERIFIED and verifiedBy is missing', async () => {
    mocks.requirementCitationFindFirst.mockResolvedValue({ id: 'cit-1', pageNumber: 1, comment: null });

    await expect(
      updateCitationVerification({
        citationCode: 'CIT-001',
        organisationId: ORG,
        verificationStatus: 'VERIFIED',
        verifiedBy: '',
      }),
    ).rejects.toThrow('verifiedBy is required');
  });

  it('throws when VERIFIED and both pageNumber and comment are missing', async () => {
    mocks.requirementCitationFindFirst.mockResolvedValue({ id: 'cit-1', pageNumber: null, comment: null });

    await expect(
      updateCitationVerification({
        citationCode: 'CIT-001',
        organisationId: ORG,
        verificationStatus: 'VERIFIED',
        verifiedBy: 'reviewer@example.com',
      }),
    ).rejects.toThrow('pageNumber or comment is required');
  });

  it('succeeds when VERIFIED with verifiedBy and pageNumber', async () => {
    mocks.requirementCitationFindFirst.mockResolvedValue({ id: 'cit-1', pageNumber: null, comment: null });
    mocks.requirementCitationUpdate.mockResolvedValue({ id: 'cit-1', verificationStatus: 'VERIFIED' });

    const result = await updateCitationVerification({
      citationCode: 'CIT-001',
      organisationId: ORG,
      verificationStatus: 'VERIFIED',
      verifiedBy: 'reviewer@example.com',
      pageNumber: 5,
    });

    expect(result.verificationStatus).toBe('VERIFIED');
  });
});

// ---------------------------------------------------------------------------
// getDocumentById
// ---------------------------------------------------------------------------
describe('getDocumentById', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns the document when found', async () => {
    mocks.documentRecordFindFirst.mockResolvedValue({
      id: 'doc-1',
      originalName: 'file.pdf',
      absolutePath: '/docs/file.pdf',
      mimeType: 'application/pdf',
    });

    const result = await getDocumentById('doc-1', ORG);

    expect(result).toMatchObject({ id: 'doc-1', mimeType: 'application/pdf' });
    expect(mocks.documentRecordFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'doc-1', organisationId: ORG },
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// getRequirementReportRows
// ---------------------------------------------------------------------------
describe('getRequirementReportRows', () => {
  beforeEach(() => vi.resetAllMocks());

  it('restricts to VERIFIED by default', async () => {
    mocks.requirementRecordFindMany.mockResolvedValue([]);

    await getRequirementReportRows({ organisationId: ORG });

    const where = mocks.requirementRecordFindMany.mock.calls[0][0].where;
    expect(where.verificationStatus).toBe('VERIFIED');
    expect(where.project).toEqual({ organisationId: ORG });
  });

  it('does not restrict verificationStatus when includePreliminary is true', async () => {
    mocks.requirementRecordFindMany.mockResolvedValue([]);

    await getRequirementReportRows({ organisationId: ORG, includePreliminary: true });

    const where = mocks.requirementRecordFindMany.mock.calls[0][0].where;
    expect(where.verificationStatus).toBeUndefined();
  });

  it('applies projectId filter when provided', async () => {
    mocks.requirementRecordFindMany.mockResolvedValue([]);

    await getRequirementReportRows({ organisationId: ORG, projectId: 'proj-1' });

    const where = mocks.requirementRecordFindMany.mock.calls[0][0].where;
    expect(where.project).toEqual({ organisationId: ORG, id: 'proj-1' });
  });
});

// ---------------------------------------------------------------------------
// getRequirementReportCases
// ---------------------------------------------------------------------------
describe('getRequirementReportCases', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns empty array for empty caseIds', async () => {
    const result = await getRequirementReportCases([], { organisationId: ORG });
    expect(result).toEqual([]);
    expect(mocks.requirementCaseFindMany).not.toHaveBeenCalled();
  });

  it('queries by id and organisationId when caseIds are provided', async () => {
    mocks.requirementCaseFindMany.mockResolvedValue([{ id: 'case-1' }]);

    const result = await getRequirementReportCases(['case-1'], { organisationId: ORG });

    expect(result).toHaveLength(1);
    const where = mocks.requirementCaseFindMany.mock.calls[0][0].where;
    expect(where.id).toEqual({ in: ['case-1'] });
    expect(where.organisationId).toBe(ORG);
  });
});

// ---------------------------------------------------------------------------
// getRequirementReportCitations
// ---------------------------------------------------------------------------
describe('getRequirementReportCitations', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns empty array for empty requirementIds', async () => {
    const result = await getRequirementReportCitations([], { organisationId: ORG });
    expect(result).toEqual([]);
    expect(mocks.requirementCitationFindMany).not.toHaveBeenCalled();
  });

  it('queries citations filtered by requirementId and organisationId', async () => {
    mocks.requirementCitationFindMany.mockResolvedValue([{ id: 'cit-1' }]);

    const result = await getRequirementReportCitations(['r1'], { organisationId: ORG });

    expect(result).toHaveLength(1);
    const where = mocks.requirementCitationFindMany.mock.calls[0][0].where;
    expect(where.requirementId).toEqual({ in: ['r1'] });
    expect(where.requirement).toMatchObject({ project: { organisationId: ORG } });
  });

  it('propagates database errors during case listing', async () => {
    mocks.requirementCaseFindMany.mockRejectedValue(new Error('query failed'));

    await expect(listRequirementCases({ organisationId: ORG })).rejects.toThrow('query failed');
  });

  it('propagates database errors during row listing', async () => {
    mocks.requirementRecordFindMany.mockRejectedValue(new Error('query failed'));

    await expect(listRequirementRows({ organisationId: ORG })).rejects.toThrow('query failed');
  });

  it('propagates database errors during citation listing', async () => {
    mocks.requirementCitationFindMany.mockRejectedValue(new Error('query failed'));

    await expect(listRequirementCitations({ organisationId: ORG })).rejects.toThrow('query failed');
  });

  it('handles database errors during requirement lookup', async () => {
    mocks.requirementRecordFindFirst.mockRejectedValue(new Error('lookup failed'));

    await expect(getRequirementByCode('REQ-001', ORG)).rejects.toThrow('lookup failed');
  });

  it('handles database errors during case lookup', async () => {
    mocks.requirementCaseFindFirst.mockRejectedValue(new Error('lookup failed'));

    await expect(getRequirementCaseById('case-1', ORG)).rejects.toThrow('lookup failed');
  });

  it('handles database errors during citation lookup', async () => {
    mocks.requirementCitationFindFirst.mockRejectedValue(new Error('lookup failed'));

    await expect(getCitationByCode('CIT-001', ORG)).rejects.toThrow('lookup failed');
  });

  it('handles database errors during document lookup', async () => {
    mocks.documentRecordFindFirst.mockRejectedValue(new Error('lookup failed'));

    await expect(getDocumentById('doc-1', ORG)).rejects.toThrow('lookup failed');
  });

  it('handles database errors during case review update', async () => {
    mocks.requirementCaseFindFirst.mockResolvedValue({ id: 'case-1' });
    mocks.requirementCaseUpdate.mockRejectedValue(new Error('update failed'));

    await expect(
      updateRequirementCaseReview({
        caseId: 'case-1',
        organisationId: ORG,
        caseReviewStatus: 'AUTO',
      }),
    ).rejects.toThrow('update failed');
  });

  it('handles database errors during requirement verification update', async () => {
    mocks.requirementRecordFindFirst.mockResolvedValue({ id: 'r1', citations: [] });
    mocks.requirementRecordUpdate.mockRejectedValue(new Error('update failed'));

    await expect(
      updateRequirementVerification({
        requirementCode: 'REQ-001',
        organisationId: ORG,
        verificationStatus: 'AUTO',
      }),
    ).rejects.toThrow('update failed');
  });

  it('handles database errors during citation verification update', async () => {
    mocks.requirementCitationFindFirst.mockResolvedValue({ id: 'cit-1', pageNumber: 1 });
    mocks.requirementCitationUpdate.mockRejectedValue(new Error('update failed'));

    await expect(
      updateCitationVerification({
        citationCode: 'CIT-001',
        organisationId: ORG,
        verificationStatus: 'AUTO',
      }),
    ).rejects.toThrow('update failed');
  });

  it('blocks citation updates when case is LOCKED and actor is not system', async () => {
    mocks.requirementCitationFindFirst.mockResolvedValue({
      id: 'cit-1',
      pageNumber: 1,
      requirement: { id: 'r1' },
      case: { caseReviewStatus: 'LOCKED' },
    });

    await expect(
      updateCitationVerification({
        citationCode: 'CIT-001',
        organisationId: ORG,
        verificationStatus: 'AUTO',
        actorKind: 'user',
      }),
    ).rejects.toThrow(/REQUIREMENT_LOCKED/);
  });

  it('handles very large pagination with thousands of results', async () => {
    mocks.requirementCaseCount.mockResolvedValue(50000);
    mocks.requirementCaseFindMany.mockResolvedValue(
      Array.from({ length: 1000 }, (_, i) => ({ id: `case-${i}` })),
    );

    const result = await listRequirementCases({ organisationId: ORG, page: 50, pageSize: 1000 });

    expect(result.total).toBe(50000);
    expect(result.items).toHaveLength(1000);
  });

  it('handles empty requirement codes', async () => {
    mocks.requirementRecordFindFirst.mockResolvedValue(null);

    const result = await getRequirementByCode('', ORG);

    expect(result).toBeNull();
  });

  it('handles empty citation codes', async () => {
    mocks.requirementCitationFindFirst.mockResolvedValue(null);

    const result = await getCitationByCode('', ORG);

    expect(result).toBeNull();
  });

  it('handles special characters in requirement and citation codes', async () => {
    mocks.requirementRecordFindFirst.mockResolvedValue(null);

    const result = await getRequirementByCode('REQ-!@#$%^&*()', ORG);

    expect(result).toBeNull();
  });

  it('handles very long requirement descriptions', async () => {
    const longDesc = 'A'.repeat(50000);
    mocks.requirementRecordFindFirst.mockResolvedValue({
      id: 'r-long',
      requirementCode: 'REQ-LONG',
      description: longDesc,
    });

    const result = await getRequirementByCode('REQ-LONG', ORG);

    expect(result.description.length).toBeGreaterThan(40000);
  });

  it('handles Swedish requirement terms and statuses', async () => {
    mocks.requirementCaseFindMany.mockResolvedValue([
      {
        id: 'case-swe',
        municipality: 'Stockholms kommun',
        documentType: 'MILJÖBESLUT',
      },
    ]);
    mocks.requirementCaseCount.mockResolvedValue(1);

    const result = await listRequirementCases({
      organisationId: ORG,
      municipality: 'Stockholm',
    });

    expect(result.items[0].municipality).toContain('Stockholm');
  });

  it('handles citations with partial verification metadata', async () => {
    mocks.requirementCitationFindFirst.mockResolvedValue({
      id: 'cit-partial',
      pageNumber: null,
      comment: 'Refererad på sid 45',
    });
    mocks.requirementCitationUpdate.mockResolvedValue({
      id: 'cit-partial',
      verificationStatus: 'VERIFIED',
    });

    const result = await updateCitationVerification({
      citationCode: 'CIT-PARTIAL',
      organisationId: ORG,
      verificationStatus: 'VERIFIED',
      verifiedBy: 'reviewer@example.com',
      comment: 'Refererad på sid 45',
    });

    expect(result.verificationStatus).toBe('VERIFIED');
  });

  it('handles report generation with mixed verification statuses', async () => {
    mocks.requirementCaseCount.mockResolvedValue(10);
    mocks.requirementCaseFindMany.mockResolvedValue([
      {
        id: 'case-1',
        caseReviewStatus: 'AUTO',
      },
      {
        id: 'case-2',
        caseReviewStatus: 'VERIFIED',
      },
    ]);

    const result = await listRequirementCases({ organisationId: ORG });

    expect(result.items).toContainEqual(expect.objectContaining({ caseReviewStatus: 'AUTO' }));
    expect(result.items).toContainEqual(expect.objectContaining({ caseReviewStatus: 'VERIFIED' }));
  });

  it('handles report queries with no results', async () => {
    mocks.requirementCaseFindMany.mockResolvedValue([]);

    const result = await getRequirementReportCases([], { organisationId: ORG });

    expect(result).toEqual([]);
  });

  it('handles report queries with large result sets', async () => {
    const largeList = Array.from({ length: 10000 }, (_, i) => ({
      id: `case-${i}`,
      requirementCount: Math.floor(Math.random() * 100),
    }));

    mocks.requirementCaseFindMany.mockResolvedValue(largeList);

    const result = await getRequirementReportCases(
      largeList.map((c) => c.id),
      { organisationId: ORG },
    );

    expect(result).toHaveLength(10000);
  });
});
