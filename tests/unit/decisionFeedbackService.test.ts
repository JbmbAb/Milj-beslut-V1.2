import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../server/db/prisma', () => ({
  prisma: {
    requirementCase: { findUnique: vi.fn() },
    documentRecord: { findUnique: vi.fn() },
    classificationRecommendation: {
      create: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
    },
    humanApprovalGate: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    approvalLog: { create: vi.fn(), findMany: vi.fn() },
  },
}));

vi.mock('../../server/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { prisma } from '../../server/db/prisma';
import {
  createAIRecommendation,
  getPendingRecommendationsForReview,
  markAsReviewing,
  submitApprovalReview,
  applyApprovedRecommendation,
  verifySourceIntegrity,
  openApprovalGate,
  lockApprovalGate,
  finalizeApprovalGate,
  getApprovalGateStatus,
  getApprovalAuditTrail,
} from '../../server/services/decisionFeedbackService';
import type { AIClassificationSuggestion } from '../../server/services/decisionFeedbackService';

const mockPrisma = prisma as any;

const baseSuggestion: AIClassificationSuggestion = {
  caseId: 'case-1',
  documentId: 'doc-1',
  sourceDocumentHash: 'abc123hash',
  sourceTextSegment: 'Ansökan om tillstånd för avloppsanläggning',
  aiClassification: 'APPROVED_WITH_CONDITIONS',
  aiConfidence: 'HIGH',
  aiReasoning: 'Fastigheten uppfyller MB:s krav',
  charStart: 0,
  charEnd: 50,
};

const mockRecommendation = {
  id: 'rec-1',
  caseId: 'case-1',
  documentId: 'doc-1',
  status: 'SUGGESTED',
  aiClassification: 'APPROVED_WITH_CONDITIONS',
  aiConfidence: 'HIGH',
  aiReasoning: 'Fastigheten uppfyller MB:s krav',
  sourceTextSegment: 'Ansökan om tillstånd...',
  suggestedConditions: null,
  suggestedRequirements: null,
  reviewedBy: null,
  reviewedAt: null,
  reviewNotes: null,
  reviewDecision: null,
  createdAt: new Date('2025-01-01'),
};

describe('decisionFeedbackService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.approvalLog.create.mockResolvedValue({ id: 'log-1' });
  });

  describe('createAIRecommendation', () => {
    it('skapar rekommendation i SUGGESTED-status', async () => {
      mockPrisma.requirementCase.findUnique.mockResolvedValue({ id: 'case-1' });
      mockPrisma.documentRecord.findUnique.mockResolvedValue({ id: 'doc-1', hash: 'abc123hash' });
      mockPrisma.classificationRecommendation.create.mockResolvedValue(mockRecommendation);

      const result = await createAIRecommendation(baseSuggestion);

      expect(result.status).toBe('SUGGESTED');
      expect(mockPrisma.classificationRecommendation.create).toHaveBeenCalledOnce();
    });

    it('kastar om RequirementCase inte hittas', async () => {
      mockPrisma.requirementCase.findUnique.mockResolvedValue(null);

      await expect(createAIRecommendation(baseSuggestion)).rejects.toThrow('RequirementCase not found');
    });

    it('kastar om Document inte hittas', async () => {
      mockPrisma.requirementCase.findUnique.mockResolvedValue({ id: 'case-1' });
      mockPrisma.documentRecord.findUnique.mockResolvedValue(null);

      await expect(createAIRecommendation(baseSuggestion)).rejects.toThrow('Document not found');
    });

    it('serialiserar suggestedConditions som JSON', async () => {
      const suggestionWithConditions = {
        ...baseSuggestion,
        suggestedConditions: [{ condition: 'Kontrollera markprov', deadline: '2025-06-01' }],
      };

      mockPrisma.requirementCase.findUnique.mockResolvedValue({ id: 'case-1' });
      mockPrisma.documentRecord.findUnique.mockResolvedValue({ id: 'doc-1' });
      mockPrisma.classificationRecommendation.create.mockResolvedValue(mockRecommendation);

      await createAIRecommendation(suggestionWithConditions);

      const createCall = mockPrisma.classificationRecommendation.create.mock.calls[0][0];
      expect(typeof createCall.data.suggestedConditions).toBe('string');
    });
  });

  describe('getPendingRecommendationsForReview', () => {
    it('returnerar rekommendationer för ett ärende', async () => {
      mockPrisma.classificationRecommendation.findMany.mockResolvedValue([
        mockRecommendation,
        { ...mockRecommendation, id: 'rec-2', status: 'REVIEWING' },
      ]);

      const result = await getPendingRecommendationsForReview('case-1');

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('rec-1');
    });

    it('returnerar tom array när inga rekommendationer finns', async () => {
      mockPrisma.classificationRecommendation.findMany.mockResolvedValue([]);

      const result = await getPendingRecommendationsForReview('case-nonexistent');
      expect(result).toEqual([]);
    });

    it('parsar suggestedConditions JSON korrekt', async () => {
      const conditions = [{ condition: 'Markprov' }];
      mockPrisma.classificationRecommendation.findMany.mockResolvedValue([
        { ...mockRecommendation, suggestedConditions: JSON.stringify(conditions) },
      ]);

      const result = await getPendingRecommendationsForReview('case-1');
      expect(result[0].suggestedConditions).toEqual(conditions);
    });
  });

  describe('markAsReviewing', () => {
    it('uppdaterar status till REVIEWING', async () => {
      const updated = { ...mockRecommendation, status: 'REVIEWING', reviewedBy: 'user-1' };
      mockPrisma.classificationRecommendation.update.mockResolvedValue(updated);

      const result = await markAsReviewing('rec-1', 'user-1');

      expect(result.status).toBe('REVIEWING');
      expect(mockPrisma.classificationRecommendation.update).toHaveBeenCalledOnce();
    });

    it('loggar approval-åtgärden', async () => {
      mockPrisma.classificationRecommendation.update.mockResolvedValue({
        ...mockRecommendation,
        status: 'REVIEWING',
      });

      await markAsReviewing('rec-1', 'granskare-1');

      expect(mockPrisma.approvalLog.create).toHaveBeenCalledOnce();
    });
  });

  describe('submitApprovalReview', () => {
    it('marks recommendation as APPROVED', async () => {
      mockPrisma.classificationRecommendation.findUnique.mockResolvedValue({
        ...mockRecommendation,
        status: 'REVIEWING',
      });
      const approved = { ...mockRecommendation, status: 'APPROVED', reviewDecision: 'APPROVED' };
      mockPrisma.classificationRecommendation.update.mockResolvedValue(approved);

      const result = await submitApprovalReview({
        recommendationId: 'rec-1',
        decision: 'APPROVED',
        reviewedBy: 'reviewer-1',
        reviewNotes: 'Looks good',
      });

      expect(result.status).toBe('APPROVED');
    });

    it('marks recommendation as REJECTED', async () => {
      mockPrisma.classificationRecommendation.findUnique.mockResolvedValue({
        ...mockRecommendation,
        status: 'REVIEWING',
      });
      const rejected = { ...mockRecommendation, status: 'REJECTED' };
      mockPrisma.classificationRecommendation.update.mockResolvedValue(rejected);

      const result = await submitApprovalReview({
        recommendationId: 'rec-1',
        decision: 'REJECTED',
        reviewedBy: 'reviewer-1',
      });

      expect(result.status).toBe('REJECTED');
    });

    it('keeps REVIEWING status for NEEDS_CLARIFICATION', async () => {
      mockPrisma.classificationRecommendation.findUnique.mockResolvedValue({
        ...mockRecommendation,
        status: 'REVIEWING',
      });
      const reviewing = { ...mockRecommendation, status: 'REVIEWING' };
      mockPrisma.classificationRecommendation.update.mockResolvedValue(reviewing);

      const result = await submitApprovalReview({
        recommendationId: 'rec-1',
        decision: 'NEEDS_CLARIFICATION',
        reviewedBy: 'reviewer-1',
      });

      expect(result.status).toBe('REVIEWING');
    });

    it('throws when recommendation not found', async () => {
      mockPrisma.classificationRecommendation.findUnique.mockResolvedValue(null);

      await expect(
        submitApprovalReview({ recommendationId: 'missing', decision: 'APPROVED', reviewedBy: 'u' }),
      ).rejects.toThrow('Recommendation not found');
    });

    it('throws when recommendation is in wrong state', async () => {
      mockPrisma.classificationRecommendation.findUnique.mockResolvedValue({
        ...mockRecommendation,
        status: 'APPLIED',
      });

      await expect(
        submitApprovalReview({ recommendationId: 'rec-1', decision: 'APPROVED', reviewedBy: 'u' }),
      ).rejects.toThrow('Cannot review recommendation in APPLIED state');
    });
  });

  describe('applyApprovedRecommendation', () => {
    it('applies an APPROVED recommendation successfully', async () => {
      mockPrisma.classificationRecommendation.findUnique.mockResolvedValue({
        ...mockRecommendation,
        status: 'APPROVED',
        case: { id: 'case-1' },
        caseId: 'case-1',
      });
      mockPrisma.classificationRecommendation.update.mockResolvedValue({
        ...mockRecommendation,
        status: 'APPLIED',
      });

      const result = await applyApprovedRecommendation('rec-1', 'admin-1');

      expect(result.success).toBe(true);
      expect(result.requirementCaseUpdated).toBe(true);
    });

    it('throws when recommendation is not APPROVED', async () => {
      mockPrisma.classificationRecommendation.findUnique.mockResolvedValue({
        ...mockRecommendation,
        status: 'SUGGESTED',
        case: { id: 'case-1' },
      });

      await expect(applyApprovedRecommendation('rec-1', 'admin-1')).rejects.toThrow(
        'Cannot apply recommendation in SUGGESTED state',
      );
    });

    it('throws when recommendation not found', async () => {
      mockPrisma.classificationRecommendation.findUnique.mockResolvedValue(null);

      await expect(applyApprovedRecommendation('missing', 'admin-1')).rejects.toThrow(
        'Recommendation not found',
      );
    });
  });

  describe('verifySourceIntegrity', () => {
    it('returns integrityOk=true when hashes match', async () => {
      mockPrisma.classificationRecommendation.findUnique.mockResolvedValue({
        ...mockRecommendation,
        document: { fileSha256: 'abc123hash' },
        sourceDocumentHash: 'abc123hash',
      });

      const result = await verifySourceIntegrity('rec-1');
      expect(result.integrityOk).toBe(true);
    });

    it('returns integrityOk=false when hashes differ', async () => {
      mockPrisma.classificationRecommendation.findUnique.mockResolvedValue({
        ...mockRecommendation,
        document: { fileSha256: 'newhash' },
        sourceDocumentHash: 'abc123hash',
      });

      const result = await verifySourceIntegrity('rec-1');
      expect(result.integrityOk).toBe(false);
      expect(result.message).toMatch(/changed/);
    });

    it('throws when recommendation not found', async () => {
      mockPrisma.classificationRecommendation.findUnique.mockResolvedValue(null);
      await expect(verifySourceIntegrity('missing')).rejects.toThrow('Recommendation not found');
    });
  });

  describe('openApprovalGate', () => {
    it('creates a new gate when none exists', async () => {
      mockPrisma.humanApprovalGate.findUnique.mockResolvedValue(null);
      mockPrisma.humanApprovalGate.create.mockResolvedValue({ id: 'gate-1', isOpen: true });

      const result = await openApprovalGate('case-1', 'doc-1');
      expect(result.isOpen).toBe(true);
      expect(mockPrisma.humanApprovalGate.create).toHaveBeenCalled();
    });

    it('re-opens a closed gate', async () => {
      mockPrisma.humanApprovalGate.findUnique.mockResolvedValue({ id: 'gate-1', isOpen: false });
      mockPrisma.humanApprovalGate.update.mockResolvedValue({ id: 'gate-1', isOpen: true });

      const result = await openApprovalGate('case-1', 'doc-1');
      expect(mockPrisma.humanApprovalGate.update).toHaveBeenCalled();
      expect(result.isOpen).toBe(true);
    });

    it('returns existing open gate without update', async () => {
      const existing = { id: 'gate-1', isOpen: true };
      mockPrisma.humanApprovalGate.findUnique.mockResolvedValue(existing);

      const result = await openApprovalGate('case-1', 'doc-1');
      expect(mockPrisma.humanApprovalGate.update).not.toHaveBeenCalled();
      expect(result).toBe(existing);
    });
  });

  describe('lockApprovalGate', () => {
    it('locks an open gate', async () => {
      mockPrisma.humanApprovalGate.findUnique.mockResolvedValue({ id: 'gate-1', isOpen: true });
      mockPrisma.humanApprovalGate.update.mockResolvedValue({ id: 'gate-1', isOpen: false });

      const result = await lockApprovalGate('case-1', 'doc-1', 'admin-1');
      expect(result.isOpen).toBe(false);
    });

    it('throws when gate not found', async () => {
      mockPrisma.humanApprovalGate.findUnique.mockResolvedValue(null);

      await expect(lockApprovalGate('case-1', 'doc-1', 'admin-1')).rejects.toThrow('Approval gate not found');
    });
  });

  describe('finalizeApprovalGate', () => {
    it('finalizes an existing gate', async () => {
      mockPrisma.humanApprovalGate.findUnique.mockResolvedValue({ id: 'gate-1' });
      mockPrisma.humanApprovalGate.update.mockResolvedValue({ id: 'gate-1', finalizedAt: new Date() });

      const result = await finalizeApprovalGate('case-1', 'doc-1');
      expect(mockPrisma.humanApprovalGate.update).toHaveBeenCalled();
      expect((result as any).finalizedAt).toBeDefined();
    });

    it('throws when gate not found', async () => {
      mockPrisma.humanApprovalGate.findUnique.mockResolvedValue(null);
      await expect(finalizeApprovalGate('case-1', 'doc-1')).rejects.toThrow('Approval gate not found');
    });
  });

  describe('getApprovalGateStatus', () => {
    it('returns counts for each recommendation status', async () => {
      mockPrisma.classificationRecommendation.findMany.mockResolvedValue([
        { status: 'SUGGESTED' },
        { status: 'REVIEWING' },
        { status: 'APPROVED' },
        { status: 'REJECTED' },
        { status: 'APPLIED' },
      ]);
      mockPrisma.humanApprovalGate.findUnique.mockResolvedValue({ isOpen: true });

      const status = await getApprovalGateStatus('case-1', 'doc-1');
      expect(status.pendingCount).toBe(1);
      expect(status.reviewingCount).toBe(1);
      expect(status.approvedCount).toBe(1);
      expect(status.rejectedCount).toBe(1);
      expect(status.appliedCount).toBe(1);
      expect(status.totalCount).toBe(5);
      expect(status.isOpen).toBe(true);
    });

    it('returns isOpen=false when gate not found', async () => {
      mockPrisma.classificationRecommendation.findMany.mockResolvedValue([]);
      mockPrisma.humanApprovalGate.findUnique.mockResolvedValue(null);

      const status = await getApprovalGateStatus('case-1', 'doc-1');
      expect(status.isOpen).toBe(false);
    });
  });

  describe('getApprovalAuditTrail', () => {
    it('returns all approval logs for recommendation', async () => {
      mockPrisma.approvalLog.findMany = vi.fn().mockResolvedValue([{ id: 'log-1', action: 'APPROVED' }]);

      const trail = await getApprovalAuditTrail('rec-1');
      expect(Array.isArray(trail)).toBe(true);
      expect(trail[0].id).toBe('log-1');
    });
  });
});
