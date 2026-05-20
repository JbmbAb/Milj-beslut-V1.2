import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  listRequirementCases,
  listRequirementRows,
  listRequirementCitations as _listRequirementCitations,
  getRequirementByCode,
  getCitationByCode as _getCitationByCode,
  getRequirementCaseById as _getRequirementCaseById,
  updateRequirementCaseReview,
  updateRequirementVerification,
  updateCitationVerification,
  getRequirementReportRows,
  getRequirementReportCases,
  getRequirementReportCitations,
} from '../../server/repositories/requirementsRepository';
import { prisma } from '../../server/db/prisma';

vi.mock('../../server/db/prisma', () => ({
  prisma: {
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
  },
}));

describe('server/repositories/requirementsRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('listRequirementCases', () => {
    it('lists requirement cases with pagination', async () => {
      const input = {
        organisationId: 'org1',
        page: 1,
        pageSize: 10,
      };

      vi.mocked(prisma.requirementCase.count).mockResolvedValue(25);
      vi.mocked(prisma.requirementCase.findMany).mockResolvedValue([
        {
          id: 'case1',
          municipality: 'Stockholm',
          documentType: 'MKB',
          documentDate: new Date(),
          createdAt: new Date(),
        },
      ] as any);

      const result = await listRequirementCases(input);

      expect(result.total).toBe(25);
      expect(result.items).toHaveLength(1);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(10);
    });

    it('enforces organisationId filter', async () => {
      const input = {
        organisationId: 'org1',
      };

      vi.mocked(prisma.requirementCase.count).mockResolvedValue(0);
      vi.mocked(prisma.requirementCase.findMany).mockResolvedValue([]);

      await listRequirementCases(input);

      const countCall = vi.mocked(prisma.requirementCase.count).mock.calls[0][0];
      expect(countCall.where).toHaveProperty('organisationId', 'org1');
    });

    it('respects municipality filter', async () => {
      const input = {
        organisationId: 'org1',
        municipality: 'Stockholm',
      };

      vi.mocked(prisma.requirementCase.count).mockResolvedValue(5);
      vi.mocked(prisma.requirementCase.findMany).mockResolvedValue([]);

      await listRequirementCases(input);

      const countCall = vi.mocked(prisma.requirementCase.count).mock.calls[0][0];
      expect(countCall.where.municipality).toBeDefined();
    });

    it('handles pagination boundaries', async () => {
      const input = {
        organisationId: 'org1',
        page: 0,
        pageSize: 500,
      };

      vi.mocked(prisma.requirementCase.count).mockResolvedValue(100);
      vi.mocked(prisma.requirementCase.findMany).mockResolvedValue([]);

      const result = await listRequirementCases(input);

      expect(result.page).toBe(1); // Should normalize to 1
      expect(result.pageSize).toBe(200); // Should cap at 200
    });
  });

  describe('listRequirementRows', () => {
    it('lists requirement records with includes', async () => {
      const input = {
        organisationId: 'org1',
      };

      vi.mocked(prisma.requirementRecord.count).mockResolvedValue(10);
      vi.mocked(prisma.requirementRecord.findMany).mockResolvedValue([
        {
          id: 'req1',
          requirementCode: 'REQ-001',
          verificationStatus: 'VERIFIED',
          case: { id: 'case1' },
        },
      ] as any);

      const result = await listRequirementRows(input);

      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toHaveProperty('case');
    });

    it('defaults to VERIFIED status when not preliminary', async () => {
      const input = {
        organisationId: 'org1',
        includePreliminary: false,
      };

      vi.mocked(prisma.requirementRecord.count).mockResolvedValue(0);
      vi.mocked(prisma.requirementRecord.findMany).mockResolvedValue([]);

      await listRequirementRows(input);

      const countCall = vi.mocked(prisma.requirementRecord.count).mock.calls[0][0];
      expect(countCall.where.verificationStatus).toBe('VERIFIED');
    });

    it('includes preliminary items when specified', async () => {
      const input = {
        organisationId: 'org1',
        includePreliminary: true,
      };

      vi.mocked(prisma.requirementRecord.count).mockResolvedValue(0);
      vi.mocked(prisma.requirementRecord.findMany).mockResolvedValue([]);

      await listRequirementRows(input);

      const countCall = vi.mocked(prisma.requirementRecord.count).mock.calls[0][0];
      expect(countCall.where.verificationStatus).toBeUndefined();
    });
  });

  describe('getRequirementByCode', () => {
    it('fetches requirement with citations and case', async () => {
      const code = 'REQ-001';
      const org = 'org1';

      vi.mocked(prisma.requirementRecord.findFirst).mockResolvedValue({
        id: 'req1',
        requirementCode: code,
        verificationStatus: 'VERIFIED',
        case: { id: 'case1' },
        citations: [{ id: 'cit1' }],
      } as any);

      const result = await getRequirementByCode(code, org);

      expect(result?.requirementCode).toBe(code);
      expect(result?.citations).toHaveLength(1);
    });

    it('enforces organisationId through project', async () => {
      vi.mocked(prisma.requirementRecord.findFirst).mockResolvedValue(null);

      await getRequirementByCode('REQ-001', 'org1');

      const call = vi.mocked(prisma.requirementRecord.findFirst).mock.calls[0][0];
      expect(call.where.project?.organisationId).toBe('org1');
    });

    it('returns null when not found', async () => {
      vi.mocked(prisma.requirementRecord.findFirst).mockResolvedValue(null);

      const result = await getRequirementByCode('NONEXISTENT', 'org1');

      expect(result).toBeNull();
    });
  });

  describe('updateRequirementCaseReview', () => {
    it('throws when case not found', async () => {
      vi.mocked(prisma.requirementCase.findFirst).mockResolvedValue(null);

      await expect(
        updateRequirementCaseReview({
          caseId: 'nonexistent',
          organisationId: 'org1',
          caseReviewStatus: 'AUTO',
        }),
      ).rejects.toThrow('Requirement case not found');
    });

    it('requires validatedBy for manual status', async () => {
      vi.mocked(prisma.requirementCase.findFirst).mockResolvedValue({
        id: 'case1',
      } as any);

      await expect(
        updateRequirementCaseReview({
          caseId: 'case1',
          organisationId: 'org1',
          caseReviewStatus: 'NEEDS_REVIEW',
          validatedBy: undefined,
        }),
      ).rejects.toThrow('validatedBy is required when setting a manual case review status');
    });

    it('allows AUTO status without validatedBy', async () => {
      vi.mocked(prisma.requirementCase.findFirst).mockResolvedValue({
        id: 'case1',
      } as any);

      vi.mocked(prisma.requirementCase.update).mockResolvedValue({
        id: 'case1',
        caseReviewStatus: 'AUTO',
      } as any);

      await expect(
        updateRequirementCaseReview({
          caseId: 'case1',
          organisationId: 'org1',
          caseReviewStatus: 'AUTO',
        }),
      ).resolves.not.toThrow();
    });

    it('updates with validation data', async () => {
      const now = new Date();
      vi.mocked(prisma.requirementCase.findFirst).mockResolvedValue({
        id: 'case1',
      } as any);

      vi.mocked(prisma.requirementCase.update).mockResolvedValue({
        id: 'case1',
        caseReviewStatus: 'VERIFIED',
        validatedBy: 'validator1',
        validatedAt: now,
      } as any);

      await updateRequirementCaseReview({
        caseId: 'case1',
        organisationId: 'org1',
        caseReviewStatus: 'VERIFIED',
        validatedBy: 'validator1',
        validatedAt: now,
      });

      const updateCall = vi.mocked(prisma.requirementCase.update).mock.calls[0][0];
      expect(updateCall.data.validatedBy).toBe('validator1');
    });
  });

  describe('updateRequirementVerification', () => {
    it('throws when requirement not found', async () => {
      vi.mocked(prisma.requirementRecord.findFirst).mockResolvedValue(null);

      await expect(
        updateRequirementVerification({
          requirementCode: 'NONEXISTENT',
          organisationId: 'org1',
          verificationStatus: 'VERIFIED',
        }),
      ).rejects.toThrow('Requirement not found');
    });

    it('requires verifiedBy for VERIFIED status', async () => {
      vi.mocked(prisma.requirementRecord.findFirst).mockResolvedValue({
        id: 'req1',
        citations: [],
      } as any);

      await expect(
        updateRequirementVerification({
          requirementCode: 'REQ-001',
          organisationId: 'org1',
          verificationStatus: 'VERIFIED',
        }),
      ).rejects.toThrow('verifiedBy is required when setting VERIFIED');
    });

    it('requires all citations to be reviewed before verification', async () => {
      vi.mocked(prisma.requirementRecord.findFirst).mockResolvedValue({
        id: 'req1',
        citations: [{ id: 'cit1', verificationStatus: 'AUTO' }],
      } as any);

      await expect(
        updateRequirementVerification({
          requirementCode: 'REQ-001',
          organisationId: 'org1',
          verificationStatus: 'VERIFIED',
          verifiedBy: 'user1',
        }),
      ).rejects.toThrow('All citations must be REVIEWED or VERIFIED before requirement can be VERIFIED');
    });
  });

  describe('updateCitationVerification', () => {
    it('throws when citation not found', async () => {
      vi.mocked(prisma.requirementCitation.findFirst).mockResolvedValue(null);

      await expect(
        updateCitationVerification({
          citationCode: 'NONEXISTENT',
          organisationId: 'org1',
          verificationStatus: 'VERIFIED',
        }),
      ).rejects.toThrow('Citation not found');
    });

    it('requires verifiedBy for VERIFIED status', async () => {
      vi.mocked(prisma.requirementCitation.findFirst).mockResolvedValue({
        id: 'cit1',
        pageNumber: 1,
      } as any);

      await expect(
        updateCitationVerification({
          citationCode: 'CIT-001',
          organisationId: 'org1',
          verificationStatus: 'VERIFIED',
        }),
      ).rejects.toThrow('verifiedBy is required when setting VERIFIED');
    });

    it('requires pageNumber or comment for VERIFIED status', async () => {
      vi.mocked(prisma.requirementCitation.findFirst).mockResolvedValue({
        id: 'cit1',
        pageNumber: null,
        comment: null,
      } as any);

      await expect(
        updateCitationVerification({
          citationCode: 'CIT-001',
          organisationId: 'org1',
          verificationStatus: 'VERIFIED',
          verifiedBy: 'user1',
        }),
      ).rejects.toThrow('pageNumber or comment is required when setting VERIFIED');
    });
  });

  describe('getRequirementReportRows', () => {
    it('filters by verification status by default', async () => {
      vi.mocked(prisma.requirementRecord.findMany).mockResolvedValue([]);

      await getRequirementReportRows({
        organisationId: 'org1',
      });

      const call = vi.mocked(prisma.requirementRecord.findMany).mock.calls[0][0];
      expect(call.where.verificationStatus).toBe('VERIFIED');
    });

    it('includes preliminary when specified', async () => {
      vi.mocked(prisma.requirementRecord.findMany).mockResolvedValue([]);

      await getRequirementReportRows({
        organisationId: 'org1',
        includePreliminary: true,
      });

      const call = vi.mocked(prisma.requirementRecord.findMany).mock.calls[0][0];
      expect(call.where.verificationStatus).toBeUndefined();
    });

    it('filters by projectId when provided', async () => {
      vi.mocked(prisma.requirementRecord.findMany).mockResolvedValue([]);

      await getRequirementReportRows({
        organisationId: 'org1',
        projectId: 'proj1',
      });

      const call = vi.mocked(prisma.requirementRecord.findMany).mock.calls[0][0];
      expect(call.where.project?.id).toBe('proj1');
    });
  });

  describe('getRequirementReportCases', () => {
    it('returns empty array for empty caseIds', async () => {
      const result = await getRequirementReportCases([], { organisationId: 'org1' });
      expect(result).toEqual([]);
    });

    it('fetches cases by IDs', async () => {
      const caseIds = ['case1', 'case2'];
      vi.mocked(prisma.requirementCase.findMany).mockResolvedValue([{ id: 'case1' }, { id: 'case2' }] as any);

      const result = await getRequirementReportCases(caseIds, { organisationId: 'org1' });

      expect(result).toHaveLength(2);
      const call = vi.mocked(prisma.requirementCase.findMany).mock.calls[0][0];
      expect((call.where.id as any)?.in as any).toEqual(caseIds);
    });

    it('enforces organisation filter', async () => {
      vi.mocked(prisma.requirementCase.findMany).mockResolvedValue([]);

      await getRequirementReportCases(['case1'], { organisationId: 'org1' });

      const call = vi.mocked(prisma.requirementCase.findMany).mock.calls[0][0];
      expect(call.where.organisationId).toBe('org1');
    });
  });

  describe('getRequirementReportCitations', () => {
    it('returns empty array for empty requirementIds', async () => {
      const result = await getRequirementReportCitations([], { organisationId: 'org1' });
      expect(result).toEqual([]);
    });

    it('filters to reviewed/verified citations', async () => {
      vi.mocked(prisma.requirementCitation.findMany).mockResolvedValue([]);

      await getRequirementReportCitations(['req1'], { organisationId: 'org1' });

      const call = vi.mocked(prisma.requirementCitation.findMany).mock.calls[0][0];
      expect((call.where.verificationStatus as any)?.in as any).toContain('REVIEWED');
      expect((call.where.verificationStatus as any)?.in as any).toContain('VERIFIED');
    });

    it('enforces organisation via requirement', async () => {
      vi.mocked(prisma.requirementCitation.findMany).mockResolvedValue([]);

      await getRequirementReportCitations(['req1'], { organisationId: 'org1' });

      const call = vi.mocked(prisma.requirementCitation.findMany).mock.calls[0][0];
      expect(call.where.requirement?.project?.organisationId).toBe('org1');
    });
  });
});
