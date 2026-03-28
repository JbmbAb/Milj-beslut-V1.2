import { beforeEach, describe, expect, it, vi } from 'vitest';

const prisma = vi.hoisted(() => ({
  requirementCase: {
    count: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  requirementRecord: {
    count: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  requirementCitation: {
    count: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  documentRecord: {
    findFirst: vi.fn(),
  },
}));

vi.mock('../../server/db/prisma', () => ({ prisma }));

import {
  getCitationByCode,
  getDocumentById,
  getRequirementByCode,
  getRequirementCaseById,
  getRequirementReportCases,
  getRequirementReportCitations,
  getRequirementReportRows,
  listRequirementCases,
  listRequirementCitations,
  listRequirementRows,
  updateCitationVerification,
  updateRequirementCaseReview,
  updateRequirementVerification,
} from '../../server/repositories/requirementsRepository';

describe('requirementsRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists requirement cases with normalized filters and pagination', async () => {
    prisma.requirementCase.count.mockResolvedValue(12);
    prisma.requirementCase.findMany.mockResolvedValue([{ id: 'case-1' }]);

    const result = await listRequirementCases({
      organisationId: 'org-1',
      municipality: '  Orsa ',
      documentType: 'ANMALAN',
      verificationStatus: 'REVIEWED',
      projectId: 'project-1',
      page: 2,
      pageSize: 10,
    });

    expect(result).toEqual({
      items: [{ id: 'case-1' }],
      total: 12,
      page: 2,
      pageSize: 10,
    });
    expect(prisma.requirementCase.count).toHaveBeenCalledWith({
      where: {
        municipality: { contains: 'Orsa', mode: 'insensitive' },
        documentType: 'ANMALAN',
        reviewStatus: 'REVIEWED',
        organisationId: 'org-1',
        projectId: 'project-1',
      },
    });
    expect(prisma.requirementCase.findMany).toHaveBeenCalledWith({
      where: {
        municipality: { contains: 'Orsa', mode: 'insensitive' },
        documentType: 'ANMALAN',
        reviewStatus: 'REVIEWED',
        organisationId: 'org-1',
        projectId: 'project-1',
      },
      orderBy: [{ documentDate: 'desc' }, { createdAt: 'desc' }],
      skip: 10,
      take: 10,
    });
  });

  it('lists requirement rows with default verified filter and clamped pagination', async () => {
    prisma.requirementRecord.count.mockResolvedValue(1);
    prisma.requirementRecord.findMany.mockResolvedValue([{ id: 'req-1' }]);

    const result = await listRequirementRows({
      organisationId: 'org-2',
      municipality: ' Mora ',
      documentType: 'BESLUT',
      category: 'Water',
      ewcCode: '17 05 04',
      caseId: 'case-2',
      requirementCode: 'REQ-2',
      includePreliminary: false,
      page: 0,
      pageSize: 999,
      projectId: 'project-2',
    });

    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(200);
    expect(prisma.requirementRecord.count).toHaveBeenCalledWith({
      where: {
        verificationStatus: 'VERIFIED',
        caseId: 'case-2',
        requirementCode: 'REQ-2',
        category: 'Water',
        ewcCode: '17 05 04',
        case: {
          municipality: { contains: 'Mora', mode: 'insensitive' },
          documentType: 'BESLUT',
        },
        project: {
          organisationId: 'org-2',
        },
        projectId: 'project-2',
      },
    });
  });

  it('lists requirement rows with an explicit verification filter when provided', async () => {
    prisma.requirementRecord.count.mockResolvedValue(3);
    prisma.requirementRecord.findMany.mockResolvedValue([{ id: 'req-explicit' }]);

    await expect(
      listRequirementRows({
        organisationId: 'org-2b',
        includePreliminary: true,
        verificationStatus: 'REJECTED',
      }),
    ).resolves.toEqual({
      items: [{ id: 'req-explicit' }],
      total: 3,
      page: 1,
      pageSize: 25,
    });

    expect(prisma.requirementRecord.count).toHaveBeenCalledWith({
      where: {
        verificationStatus: 'REJECTED',
        project: {
          organisationId: 'org-2b',
        },
      },
    });
  });

  it('lists requirement citations with requirement and project filters', async () => {
    prisma.requirementCitation.count.mockResolvedValue(2);
    prisma.requirementCitation.findMany.mockResolvedValue([{ id: 'cit-1' }]);

    const result = await listRequirementCitations({
      organisationId: 'org-3',
      requirementCode: 'REQ-3',
      verificationStatus: 'REJECTED',
      includePreliminary: true,
      projectId: 'project-3',
    });

    expect(result).toEqual({
      items: [{ id: 'cit-1' }],
      total: 2,
      page: 1,
      pageSize: 25,
    });
    expect(prisma.requirementCitation.count).toHaveBeenCalledWith({
      where: {
        verificationStatus: 'REJECTED',
        requirement: {
          project: {
            organisationId: 'org-3',
          },
          requirementCode: 'REQ-3',
          projectId: 'project-3',
        },
      },
    });
  });

  it('lists requirement citations with the default verified requirement filter when preliminary data is excluded', async () => {
    prisma.requirementCitation.count.mockResolvedValue(4);
    prisma.requirementCitation.findMany.mockResolvedValue([{ id: 'cit-default' }]);

    await expect(
      listRequirementCitations({
        organisationId: 'org-3b',
        includePreliminary: false,
      }),
    ).resolves.toEqual({
      items: [{ id: 'cit-default' }],
      total: 4,
      page: 1,
      pageSize: 25,
    });

    expect(prisma.requirementCitation.count).toHaveBeenCalledWith({
      where: {
        requirement: {
          verificationStatus: 'VERIFIED',
          project: {
            organisationId: 'org-3b',
          },
        },
      },
    });
  });

  it('loads requirement, citation, case and document helpers with organisation scoping', async () => {
    prisma.requirementRecord.findFirst.mockResolvedValue({ id: 'req-4' });
    prisma.requirementCitation.findFirst.mockResolvedValue({ id: 'cit-4' });
    prisma.requirementCase.findFirst.mockResolvedValue({ id: 'case-4' });
    prisma.documentRecord.findFirst.mockResolvedValue({ id: 'doc-4' });

    await expect(getRequirementByCode('REQ-4', 'org-4')).resolves.toEqual({ id: 'req-4' });
    await expect(getCitationByCode('CIT-4', 'org-4')).resolves.toEqual({ id: 'cit-4' });
    await expect(getRequirementCaseById('case-4', 'org-4')).resolves.toEqual({ id: 'case-4' });
    await expect(getDocumentById('doc-4', 'org-4')).resolves.toEqual({ id: 'doc-4' });
  });

  it('validates case review updates and supports the default review-status mapping branch', async () => {
    prisma.requirementCase.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'case-5' })
      .mockResolvedValueOnce({ id: 'case-5' })
      .mockResolvedValueOnce({ id: 'case-6' });
    prisma.requirementCase.update
      .mockResolvedValueOnce({ id: 'case-5', caseReviewStatus: 'AUTO' })
      .mockResolvedValueOnce({ id: 'case-6', caseReviewStatus: 'OTHER' });

    await expect(
      updateRequirementCaseReview({
        caseId: 'missing',
        organisationId: 'org-5',
        caseReviewStatus: 'AUTO',
      }),
    ).rejects.toThrow('Requirement case not found');

    await expect(
      updateRequirementCaseReview({
        caseId: 'case-5',
        organisationId: 'org-5',
        caseReviewStatus: 'NEEDS_REVIEW',
      }),
    ).rejects.toThrow('validatedBy is required when setting a manual case review status');

    await expect(
      updateRequirementCaseReview({
        caseId: 'case-5',
        organisationId: 'org-5',
        caseReviewStatus: 'AUTO',
        notes: '  ',
      }),
    ).resolves.toEqual({ id: 'case-5', caseReviewStatus: 'AUTO' });

    expect(prisma.requirementCase.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'case-5' },
      data: {
        caseReviewStatus: 'AUTO',
        reviewStatus: 'AUTO',
        validatedBy: null,
        validatedAt: null,
        notes: null,
      },
    });

    await expect(
      updateRequirementCaseReview({
        caseId: 'case-6',
        organisationId: 'org-5',
        caseReviewStatus: 'OTHER' as never,
        validatedBy: 'Reviewer',
        notes: ' Note ',
      }),
    ).resolves.toEqual({ id: 'case-6', caseReviewStatus: 'OTHER' });

    expect(prisma.requirementCase.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'case-6' },
      data: {
        caseReviewStatus: 'OTHER',
        reviewStatus: 'AUTO',
        validatedBy: 'Reviewer',
        validatedAt: expect.any(Date),
        notes: 'Note',
      },
    });
  });

  it('maps NEEDS_REVIEW to REVIEWED and LOCKED to VERIFIED', async () => {
    prisma.requirementCase.findFirst
      .mockResolvedValueOnce({ id: 'case-7' })
      .mockResolvedValueOnce({ id: 'case-8' });
    prisma.requirementCase.update
      .mockResolvedValueOnce({ id: 'case-7', caseReviewStatus: 'NEEDS_REVIEW' })
      .mockResolvedValueOnce({ id: 'case-8', caseReviewStatus: 'LOCKED' });

    await updateRequirementCaseReview({
      caseId: 'case-7',
      organisationId: 'org-5b',
      caseReviewStatus: 'NEEDS_REVIEW',
      validatedBy: 'Reviewer',
    });

    await updateRequirementCaseReview({
      caseId: 'case-8',
      organisationId: 'org-5b',
      caseReviewStatus: 'LOCKED',
      validatedBy: 'Reviewer',
    });

    expect(prisma.requirementCase.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'case-7' },
      data: expect.objectContaining({
        caseReviewStatus: 'NEEDS_REVIEW',
        reviewStatus: 'REVIEWED',
      }),
    });
    expect(prisma.requirementCase.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'case-8' },
      data: expect.objectContaining({
        caseReviewStatus: 'LOCKED',
        reviewStatus: 'VERIFIED',
      }),
    });
  });

  it('validates requirement verification before allowing VERIFIED and normalizes optional fields', async () => {
    prisma.requirementRecord.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'req-6', citations: [{ verificationStatus: 'VERIFIED' }] })
      .mockResolvedValueOnce({ id: 'req-7', citations: [{ verificationStatus: 'REJECTED' }] })
      .mockResolvedValueOnce({
        id: 'req-8',
        citations: [{ verificationStatus: 'REVIEWED' }, { verificationStatus: 'VERIFIED' }],
      })
      .mockResolvedValueOnce({ id: 'req-9', citations: [] });
    prisma.requirementRecord.update
      .mockResolvedValueOnce({ id: 'req-8', verificationStatus: 'VERIFIED' })
      .mockResolvedValueOnce({ id: 'req-9', verificationStatus: 'REJECTED' });

    await expect(
      updateRequirementVerification({
        requirementCode: 'REQ-MISSING',
        organisationId: 'org-6',
        verificationStatus: 'AUTO',
      }),
    ).rejects.toThrow('Requirement not found');

    await expect(
      updateRequirementVerification({
        requirementCode: 'REQ-6',
        organisationId: 'org-6',
        verificationStatus: 'VERIFIED',
      }),
    ).rejects.toThrow('verifiedBy is required when setting VERIFIED');

    await expect(
      updateRequirementVerification({
        requirementCode: 'REQ-7',
        organisationId: 'org-6',
        verificationStatus: 'VERIFIED',
        verifiedBy: 'Verifier',
      }),
    ).rejects.toThrow('All citations must be REVIEWED or VERIFIED before requirement can be VERIFIED');

    await expect(
      updateRequirementVerification({
        requirementCode: 'REQ-8',
        organisationId: 'org-6',
        verificationStatus: 'VERIFIED',
        verifiedBy: ' Verifier ',
        validationComment: ' Looks good ',
      }),
    ).resolves.toEqual({ id: 'req-8', verificationStatus: 'VERIFIED' });

    expect(prisma.requirementRecord.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'req-8' },
      data: {
        verificationStatus: 'VERIFIED',
        verifiedBy: 'Verifier',
        verifiedAt: expect.any(Date),
        errorType: null,
        validationComment: 'Looks good',
      },
      include: {
        case: true,
        citations: true,
      },
    });

    await expect(
      updateRequirementVerification({
        requirementCode: 'REQ-9',
        organisationId: 'org-6',
        verificationStatus: 'REJECTED',
        verifiedAt: null,
        errorType: ' ManualError ',
        validationComment: '  ',
      }),
    ).resolves.toEqual({ id: 'req-9', verificationStatus: 'REJECTED' });

    expect(prisma.requirementRecord.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'req-9' },
      data: {
        verificationStatus: 'REJECTED',
        verifiedBy: null,
        verifiedAt: null,
        errorType: 'ManualError',
        validationComment: null,
      },
      include: {
        case: true,
        citations: true,
      },
    });
  });

  it('validates citation verification and supports page/comment normalization branches', async () => {
    prisma.requirementCitation.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'cit-6', comment: null, pageNumber: null })
      .mockResolvedValueOnce({ id: 'cit-7', comment: null, pageNumber: null })
      .mockResolvedValueOnce({ id: 'cit-8', comment: ' Existing ', pageNumber: 4 })
      .mockResolvedValueOnce({ id: 'cit-9', comment: 'keep', pageNumber: 2 });
    prisma.requirementCitation.update
      .mockResolvedValueOnce({ id: 'cit-8', verificationStatus: 'VERIFIED' })
      .mockResolvedValueOnce({ id: 'cit-9', verificationStatus: 'REJECTED' });

    await expect(
      updateCitationVerification({
        citationCode: 'CIT-MISSING',
        organisationId: 'org-7',
        verificationStatus: 'AUTO',
      }),
    ).rejects.toThrow('Citation not found');

    await expect(
      updateCitationVerification({
        citationCode: 'CIT-6',
        organisationId: 'org-7',
        verificationStatus: 'VERIFIED',
        pageNumber: 3,
      }),
    ).rejects.toThrow('verifiedBy is required when setting VERIFIED');

    await expect(
      updateCitationVerification({
        citationCode: 'CIT-7',
        organisationId: 'org-7',
        verificationStatus: 'VERIFIED',
        verifiedBy: 'Verifier',
      }),
    ).rejects.toThrow('pageNumber or comment is required when setting VERIFIED');

    await expect(
      updateCitationVerification({
        citationCode: 'CIT-8',
        organisationId: 'org-7',
        verificationStatus: 'VERIFIED',
        verifiedBy: ' Verifier ',
        charStart: 10,
        charEnd: 20,
      }),
    ).resolves.toEqual({ id: 'cit-8', verificationStatus: 'VERIFIED' });

    expect(prisma.requirementCitation.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'cit-8' },
      data: {
        verificationStatus: 'VERIFIED',
        verifiedBy: 'Verifier',
        verifiedAt: expect.any(Date),
        pageNumber: undefined,
        charStart: 10,
        charEnd: 20,
        comment: undefined,
      },
      include: {
        requirement: true,
        case: true,
      },
    });

    await expect(
      updateCitationVerification({
        citationCode: 'CIT-9',
        organisationId: 'org-7',
        verificationStatus: 'REJECTED',
        pageNumber: null,
        charStart: null,
        charEnd: null,
        comment: '  ',
      }),
    ).resolves.toEqual({ id: 'cit-9', verificationStatus: 'REJECTED' });

    expect(prisma.requirementCitation.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'cit-9' },
      data: {
        verificationStatus: 'REJECTED',
        verifiedBy: null,
        verifiedAt: null,
        pageNumber: null,
        charStart: null,
        charEnd: null,
        comment: null,
      },
      include: {
        requirement: true,
        case: true,
      },
    });
  });

  it('keeps char offsets undefined when they are omitted', async () => {
    prisma.requirementCitation.findFirst.mockResolvedValue({
      id: 'cit-10',
      comment: 'Existing comment',
      pageNumber: 6,
    });
    prisma.requirementCitation.update.mockResolvedValue({ id: 'cit-10', verificationStatus: 'VERIFIED' });

    await expect(
      updateCitationVerification({
        citationCode: 'CIT-10',
        organisationId: 'org-7b',
        verificationStatus: 'VERIFIED',
        verifiedBy: 'Verifier',
      }),
    ).resolves.toEqual({ id: 'cit-10', verificationStatus: 'VERIFIED' });

    expect(prisma.requirementCitation.update).toHaveBeenCalledWith({
      where: { id: 'cit-10' },
      data: {
        verificationStatus: 'VERIFIED',
        verifiedBy: 'Verifier',
        verifiedAt: expect.any(Date),
        pageNumber: undefined,
        charStart: undefined,
        charEnd: undefined,
        comment: undefined,
      },
      include: {
        requirement: true,
        case: true,
      },
    });
  });

  it('builds requirement report queries and short-circuits empty report ids', async () => {
    prisma.requirementRecord.findMany.mockResolvedValue([{ id: 'req-report-1' }]);
    prisma.requirementCase.findMany.mockResolvedValue([{ id: 'case-report-1' }]);
    prisma.requirementCitation.findMany.mockResolvedValue([{ id: 'cit-report-1' }]);

    await expect(
      getRequirementReportRows({
        organisationId: 'org-8',
      }),
    ).resolves.toEqual([{ id: 'req-report-1' }]);

    expect(prisma.requirementRecord.findMany).toHaveBeenCalledWith({
      where: {
        verificationStatus: 'VERIFIED',
        project: {
          organisationId: 'org-8',
        },
      },
      include: {
        case: true,
        citations: true,
      },
      orderBy: [{ createdAt: 'asc' }],
    });

    await expect(
      getRequirementReportRows({
        organisationId: 'org-8',
        projectId: 'project-8',
        includePreliminary: true,
      }),
    ).resolves.toEqual([{ id: 'req-report-1' }]);

    expect(prisma.requirementRecord.findMany).toHaveBeenNthCalledWith(2, {
      where: {
        project: {
          organisationId: 'org-8',
          id: 'project-8',
        },
      },
      include: {
        case: true,
        citations: true,
      },
      orderBy: [{ createdAt: 'asc' }],
    });

    await expect(getRequirementReportCases([], { organisationId: 'org-8' })).resolves.toEqual([]);
    await expect(getRequirementReportCitations([], { organisationId: 'org-8' })).resolves.toEqual([]);

    await expect(
      getRequirementReportCases(['case-1', 'case-2'], { organisationId: 'org-8', projectId: 'project-8' }),
    ).resolves.toEqual([{ id: 'case-report-1' }]);

    expect(prisma.requirementCase.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['case-1', 'case-2'] },
        organisationId: 'org-8',
        projectId: 'project-8',
      },
      orderBy: [{ documentDate: 'asc' }, { createdAt: 'asc' }],
    });

    await expect(
      getRequirementReportCitations(['req-1'], { organisationId: 'org-8', projectId: 'project-8' }),
    ).resolves.toEqual([{ id: 'cit-report-1' }]);

    expect(prisma.requirementCitation.findMany).toHaveBeenCalledWith({
      where: {
        requirementId: { in: ['req-1'] },
        verificationStatus: { in: ['REVIEWED', 'VERIFIED'] },
        requirement: {
          project: {
            organisationId: 'org-8',
            id: 'project-8',
          },
        },
      },
      orderBy: [{ createdAt: 'asc' }],
    });
  });

  it('builds report case and citation queries without project filters when projectId is omitted', async () => {
    prisma.requirementCase.findMany.mockResolvedValue([{ id: 'case-report-2' }]);
    prisma.requirementCitation.findMany.mockResolvedValue([{ id: 'cit-report-2' }]);

    await expect(getRequirementReportCases(['case-3'], { organisationId: 'org-9' })).resolves.toEqual([
      { id: 'case-report-2' },
    ]);
    expect(prisma.requirementCase.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['case-3'] },
        organisationId: 'org-9',
      },
      orderBy: [{ documentDate: 'asc' }, { createdAt: 'asc' }],
    });

    await expect(getRequirementReportCitations(['req-3'], { organisationId: 'org-9' })).resolves.toEqual([
      { id: 'cit-report-2' },
    ]);
    expect(prisma.requirementCitation.findMany).toHaveBeenCalledWith({
      where: {
        requirementId: { in: ['req-3'] },
        verificationStatus: { in: ['REVIEWED', 'VERIFIED'] },
        requirement: {
          project: {
            organisationId: 'org-9',
          },
        },
      },
      orderBy: [{ createdAt: 'asc' }],
    });
  });
});
