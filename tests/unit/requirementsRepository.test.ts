import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Prisma mock ─────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  requirementCaseCount: vi.fn(),
  requirementCaseFindMany: vi.fn(),
  requirementCaseFindFirst: vi.fn(),
  requirementCaseUpdate: vi.fn(),
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
  getRequirementByCode,
  getRequirementCaseById,
  listRequirementCases,
  listRequirementRows,
  updateRequirementCaseReview,
  updateRequirementVerification,
} from '../../server/repositories/requirementsRepository';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('requirementsRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── listRequirementCases ─────────────────────────────────────────────────

  describe('listRequirementCases', () => {
    it('returns paginated result with total count', async () => {
      mocks.requirementCaseCount.mockResolvedValue(42);
      mocks.requirementCaseFindMany.mockResolvedValue([{ id: 'case-1' }, { id: 'case-2' }]);

      const result = await listRequirementCases({ organisationId: 'org-1' });

      expect(result.total).toBe(42);
      expect(result.items).toHaveLength(2);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(25);
    });

    it('enforces organisationId in where clause', async () => {
      mocks.requirementCaseCount.mockResolvedValue(0);
      mocks.requirementCaseFindMany.mockResolvedValue([]);

      await listRequirementCases({ organisationId: 'org-SECURE' });

      const [countCall] = mocks.requirementCaseCount.mock.calls;
      expect(countCall[0].where.organisationId).toBe('org-SECURE');
    });

    it('applies municipality filter case-insensitively', async () => {
      mocks.requirementCaseCount.mockResolvedValue(0);
      mocks.requirementCaseFindMany.mockResolvedValue([]);

      await listRequirementCases({ organisationId: 'org-1', municipality: 'Stockholm' });

      const [countCall] = mocks.requirementCaseCount.mock.calls;
      expect(countCall[0].where.municipality).toEqual({
        contains: 'Stockholm',
        mode: 'insensitive',
      });
    });

    it('caps pageSize at 200', async () => {
      mocks.requirementCaseCount.mockResolvedValue(0);
      mocks.requirementCaseFindMany.mockResolvedValue([]);

      const result = await listRequirementCases({ organisationId: 'org-1', pageSize: 9999 });

      expect(result.pageSize).toBe(200);
    });

    it('uses page 1 and size 25 as defaults', async () => {
      mocks.requirementCaseCount.mockResolvedValue(0);
      mocks.requirementCaseFindMany.mockResolvedValue([]);

      const result = await listRequirementCases({ organisationId: 'org-1' });

      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(25);
    });
  });

  // ── listRequirementRows ──────────────────────────────────────────────────

  describe('listRequirementRows', () => {
    it('returns paginated items with default VERIFIED filter', async () => {
      mocks.requirementRecordCount.mockResolvedValue(5);
      mocks.requirementRecordFindMany.mockResolvedValue([{ id: 'req-1' }]);

      const result = await listRequirementRows({ organisationId: 'org-1' });

      // Default: includePreliminary=false → verificationStatus=VERIFIED
      const [countCall] = mocks.requirementRecordCount.mock.calls;
      expect(countCall[0].where.verificationStatus).toBe('VERIFIED');
      expect(result.total).toBe(5);
    });

    it('skips verificationStatus filter when includePreliminary=true', async () => {
      mocks.requirementRecordCount.mockResolvedValue(10);
      mocks.requirementRecordFindMany.mockResolvedValue([]);

      await listRequirementRows({ organisationId: 'org-1', includePreliminary: true });

      const [countCall] = mocks.requirementRecordCount.mock.calls;
      expect(countCall[0].where.verificationStatus).toBeUndefined();
    });

    it('enforces organisationId via project relation', async () => {
      mocks.requirementRecordCount.mockResolvedValue(0);
      mocks.requirementRecordFindMany.mockResolvedValue([]);

      await listRequirementRows({ organisationId: 'org-SECURE' });

      const [countCall] = mocks.requirementRecordCount.mock.calls;
      expect(countCall[0].where.project?.organisationId).toBe('org-SECURE');
    });
  });

  // ── getRequirementByCode ─────────────────────────────────────────────────

  describe('getRequirementByCode', () => {
    it('calls findFirst with code and organisationId', async () => {
      mocks.requirementRecordFindFirst.mockResolvedValue({ id: 'req-1', requirementCode: 'MB-1' });

      const result = await getRequirementByCode('MB-1', 'org-1');

      expect(result).toMatchObject({ id: 'req-1' });
      expect(mocks.requirementRecordFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            requirementCode: 'MB-1',
            project: { organisationId: 'org-1' },
          },
        }),
      );
    });

    it('returns null when not found', async () => {
      mocks.requirementRecordFindFirst.mockResolvedValue(null);

      const result = await getRequirementByCode('UNKNOWN', 'org-1');
      expect(result).toBeNull();
    });
  });

  // ── getRequirementCaseById ───────────────────────────────────────────────

  describe('getRequirementCaseById', () => {
    it('enforces organisationId in lookup', async () => {
      mocks.requirementCaseFindFirst.mockResolvedValue({ id: 'case-1' });

      await getRequirementCaseById('case-1', 'org-SECURE');

      expect(mocks.requirementCaseFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'case-1', organisationId: 'org-SECURE' },
        }),
      );
    });
  });

  // ── updateRequirementCaseReview ──────────────────────────────────────────

  describe('updateRequirementCaseReview', () => {
    it('throws when case is not found', async () => {
      mocks.requirementCaseFindFirst.mockResolvedValue(null);

      await expect(
        updateRequirementCaseReview({
          caseId: 'nonexistent',
          organisationId: 'org-1',
          caseReviewStatus: 'VERIFIED',
          validatedBy: 'User A',
        }),
      ).rejects.toThrow('Requirement case not found');
    });

    it('throws when validatedBy is missing for non-AUTO status', async () => {
      mocks.requirementCaseFindFirst.mockResolvedValue({ id: 'case-1' });

      await expect(
        updateRequirementCaseReview({
          caseId: 'case-1',
          organisationId: 'org-1',
          caseReviewStatus: 'VERIFIED',
          validatedBy: '',
        }),
      ).rejects.toThrow('validatedBy is required');
    });

    it('allows AUTO status without validatedBy', async () => {
      mocks.requirementCaseFindFirst.mockResolvedValue({ id: 'case-1' });
      mocks.requirementCaseUpdate.mockResolvedValue({ id: 'case-1', caseReviewStatus: 'AUTO' });

      await expect(
        updateRequirementCaseReview({
          caseId: 'case-1',
          organisationId: 'org-1',
          caseReviewStatus: 'AUTO',
        }),
      ).resolves.toBeDefined();
    });
  });

  // ── updateRequirementVerification ────────────────────────────────────────

  describe('updateRequirementVerification', () => {
    it('throws when requirement is not found', async () => {
      mocks.requirementRecordFindFirst.mockResolvedValue(null);

      await expect(
        updateRequirementVerification({
          requirementCode: 'MISSING',
          organisationId: 'org-1',
          verificationStatus: 'REVIEWED',
          verifiedBy: 'User A',
        }),
      ).rejects.toThrow('Requirement not found');
    });

    it('throws when setting VERIFIED without verifiedBy', async () => {
      mocks.requirementRecordFindFirst.mockResolvedValue({
        id: 'req-1',
        citations: [{ verificationStatus: 'VERIFIED' }],
      });

      await expect(
        updateRequirementVerification({
          requirementCode: 'MB-1',
          organisationId: 'org-1',
          verificationStatus: 'VERIFIED',
          verifiedBy: '',
        }),
      ).rejects.toThrow('verifiedBy is required');
    });

    it('throws when citations are not REVIEWED/VERIFIED', async () => {
      mocks.requirementRecordFindFirst.mockResolvedValue({
        id: 'req-1',
        citations: [{ verificationStatus: 'AUTO' }],
      });

      await expect(
        updateRequirementVerification({
          requirementCode: 'MB-1',
          organisationId: 'org-1',
          verificationStatus: 'VERIFIED',
          verifiedBy: 'User A',
        }),
      ).rejects.toThrow('All citations must be REVIEWED or VERIFIED');
    });

    it('updates successfully when all citations are verified', async () => {
      mocks.requirementRecordFindFirst.mockResolvedValue({
        id: 'req-1',
        citations: [
          { verificationStatus: 'VERIFIED' },
          { verificationStatus: 'REVIEWED' },
        ],
      });
      mocks.requirementRecordUpdate.mockResolvedValue({ id: 'req-1', verificationStatus: 'VERIFIED' });

      await expect(
        updateRequirementVerification({
          requirementCode: 'MB-1',
          organisationId: 'org-1',
          verificationStatus: 'VERIFIED',
          verifiedBy: 'User A',
        }),
      ).resolves.toBeDefined();
    });
  });
});
