import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createAIRecommendation: vi.fn(),
  getPendingRecommendationsForReview: vi.fn(),
  markAsReviewing: vi.fn(),
  submitApprovalReview: vi.fn(),
  applyApprovedRecommendation: vi.fn(),
  verifySourceIntegrity: vi.fn(),
  getApprovalAuditTrail: vi.fn(),
  openApprovalGate: vi.fn(),
  lockApprovalGate: vi.fn(),
  finalizeApprovalGate: vi.fn(),
  getApprovalGateStatus: vi.fn(),
}));

vi.mock('../../server/services/decisionFeedbackService', () => ({
  createAIRecommendation: mocks.createAIRecommendation,
  getPendingRecommendationsForReview: mocks.getPendingRecommendationsForReview,
  markAsReviewing: mocks.markAsReviewing,
  submitApprovalReview: mocks.submitApprovalReview,
  applyApprovedRecommendation: mocks.applyApprovedRecommendation,
  verifySourceIntegrity: mocks.verifySourceIntegrity,
  getApprovalAuditTrail: mocks.getApprovalAuditTrail,
  openApprovalGate: mocks.openApprovalGate,
  lockApprovalGate: mocks.lockApprovalGate,
  finalizeApprovalGate: mocks.finalizeApprovalGate,
  getApprovalGateStatus: mocks.getApprovalGateStatus,
}));

vi.mock('../../server/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import classificationReviewRoutes from '../../server/routes/classification-review.routes';

const app = express();
app.use(express.json());
app.use(classificationReviewRoutes);

const mockRecommendation = {
  id: 'rec-1',
  caseId: 'case-1',
  documentId: 'doc-1',
  aiClassification: 'MILJÖFARLIG_VERKSAMHET',
  confidence: 0.92,
  status: 'SUGGESTED',
  reviewedBy: null,
  createdAt: new Date().toISOString(),
};

const mockGate = {
  id: 'gate-1',
  caseId: 'case-1',
  documentId: 'doc-1',
  status: 'OPEN',
  openedAt: new Date().toISOString(),
};

describe('classification-review.routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createAIRecommendation.mockResolvedValue(mockRecommendation);
    mocks.getPendingRecommendationsForReview.mockResolvedValue([mockRecommendation]);
    mocks.markAsReviewing.mockResolvedValue({ ...mockRecommendation, status: 'REVIEWING' });
    mocks.submitApprovalReview.mockResolvedValue({ ...mockRecommendation, status: 'APPROVED' });
    mocks.applyApprovedRecommendation.mockResolvedValue({
      success: true,
      appliedAt: new Date().toISOString(),
    });
    mocks.verifySourceIntegrity.mockResolvedValue({ intact: true, hash: 'abc123' });
    mocks.getApprovalAuditTrail.mockResolvedValue([
      { event: 'CREATED', timestamp: new Date().toISOString() },
    ]);
    mocks.openApprovalGate.mockResolvedValue(mockGate);
    mocks.lockApprovalGate.mockResolvedValue({ ...mockGate, status: 'LOCKED' });
    mocks.finalizeApprovalGate.mockResolvedValue({ ...mockGate, status: 'FINALIZED' });
    mocks.getApprovalGateStatus.mockResolvedValue({
      status: 'OPEN',
      pendingCount: 1,
      approvedCount: 0,
      rejectedCount: 0,
    });
  });

  // ============================================================================
  // POST /classifications/recommend
  // ============================================================================

  describe('POST /classifications/recommend', () => {
    it('skapar AI-rekommendation med status SUGGESTED', async () => {
      const res = await request(app).post('/classifications/recommend').send({
        caseId: 'case-1',
        documentId: 'doc-1',
        aiClassification: 'MILJÖFARLIG_VERKSAMHET',
        confidence: 0.92,
      });

      expect(res.status).toBe(201);
      expect(res.body.ok).toBe(true);
      expect(res.body.status).toBe('SUGGESTED');
      expect(res.body.recommendation.id).toBe('rec-1');
    });

    it('returnerar 400 om required fields saknas', async () => {
      const res = await request(app).post('/classifications/recommend').send({ caseId: 'case-1' }); // Missing documentId and aiClassification

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Missing required fields');
    });

    it('returnerar 500 vid service-fel', async () => {
      mocks.createAIRecommendation.mockRejectedValue(new Error('Service error'));

      const res = await request(app)
        .post('/classifications/recommend')
        .send({ caseId: 'case-1', documentId: 'doc-1', aiClassification: 'RISK' });

      expect(res.status).toBe(500);
    });
  });

  // ============================================================================
  // GET /cases/:caseId/pending-reviews
  // ============================================================================

  describe('GET /cases/:caseId/pending-reviews', () => {
    it('returnerar väntande granskningar för ett ärende', async () => {
      const res = await request(app).get('/cases/case-1/pending-reviews');

      expect(res.status).toBe(200);
      expect(res.body.caseId).toBe('case-1');
      expect(res.body.pendingCount).toBe(1);
      expect(Array.isArray(res.body.recommendations)).toBe(true);
    });

    it('returnerar tom lista om inga rekommendationer finns', async () => {
      mocks.getPendingRecommendationsForReview.mockResolvedValue([]);

      const res = await request(app).get('/cases/case-99/pending-reviews');

      expect(res.status).toBe(200);
      expect(res.body.pendingCount).toBe(0);
    });
  });

  // ============================================================================
  // PATCH /classifications/:id/mark-reviewing
  // ============================================================================

  describe('PATCH /classifications/:recommendationId/mark-reviewing', () => {
    it('markerar rekommendation som REVIEWING', async () => {
      const res = await request(app)
        .patch('/classifications/rec-1/mark-reviewing')
        .send({ reviewedBy: 'handlaggare@gavle.se' });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.status).toBe('REVIEWING');
    });

    it('returnerar 400 om reviewedBy saknas', async () => {
      const res = await request(app).patch('/classifications/rec-1/mark-reviewing').send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('reviewedBy');
    });
  });

  // ============================================================================
  // POST /classifications/:id/submit-review
  // ============================================================================

  describe('POST /classifications/:recommendationId/submit-review', () => {
    it('godkänner en rekommendation (APPROVED)', async () => {
      const res = await request(app).post('/classifications/rec-1/submit-review').send({
        decision: 'APPROVED',
        reviewedBy: 'handlaggare@gavle.se',
        reviewNotes: 'Korrekt klassificering',
      });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.decision).toBe('APPROVED');
    });

    it('avvisar en rekommendation (REJECTED)', async () => {
      mocks.submitApprovalReview.mockResolvedValue({ ...mockRecommendation, status: 'REJECTED' });

      const res = await request(app).post('/classifications/rec-1/submit-review').send({
        decision: 'REJECTED',
        reviewedBy: 'handlaggare@gavle.se',
        reviewNotes: 'Felaktig klassificering',
      });

      expect(res.status).toBe(200);
      expect(res.body.decision).toBe('REJECTED');
    });

    it('returnerar 400 för ogiltigt beslut', async () => {
      const res = await request(app).post('/classifications/rec-1/submit-review').send({
        decision: 'INVALID_DECISION',
        reviewedBy: 'handlaggare@gavle.se',
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid decision');
    });

    it('returnerar 400 om reviewedBy saknas', async () => {
      const res = await request(app)
        .post('/classifications/rec-1/submit-review')
        .send({ decision: 'APPROVED' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('reviewedBy');
    });

    it('accepterar NEEDS_CLARIFICATION som giltigt beslut', async () => {
      mocks.submitApprovalReview.mockResolvedValue({
        ...mockRecommendation,
        status: 'NEEDS_CLARIFICATION',
      });

      const res = await request(app).post('/classifications/rec-1/submit-review').send({
        decision: 'NEEDS_CLARIFICATION',
        reviewedBy: 'handlaggare@gavle.se',
        reviewNotes: 'Behöver mer information',
      });

      expect(res.status).toBe(200);
      expect(res.body.decision).toBe('NEEDS_CLARIFICATION');
    });
  });

  // ============================================================================
  // POST /classifications/:id/apply
  // ============================================================================

  describe('POST /classifications/:recommendationId/apply', () => {
    it('tillämpar en godkänd rekommendation', async () => {
      const res = await request(app)
        .post('/classifications/rec-1/apply')
        .send({ appliedBy: 'system@miljo.se' });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.message).toContain('applied');
    });

    it('returnerar 400 om appliedBy saknas', async () => {
      const res = await request(app).post('/classifications/rec-1/apply').send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('appliedBy');
    });
  });

  // ============================================================================
  // GET /classifications/:id/verify-integrity
  // ============================================================================

  describe('GET /classifications/:recommendationId/verify-integrity', () => {
    it('verifierar källintegriteten', async () => {
      const res = await request(app).get('/classifications/rec-1/verify-integrity');

      expect(res.status).toBe(200);
      expect(res.body.recommendationId).toBe('rec-1');
      expect(res.body.intact).toBe(true);
    });
  });

  // ============================================================================
  // GET /classifications/:id/audit-trail
  // ============================================================================

  describe('GET /classifications/:recommendationId/audit-trail', () => {
    it('returnerar granskningens revisionsspår', async () => {
      const res = await request(app).get('/classifications/rec-1/audit-trail');

      expect(res.status).toBe(200);
      expect(res.body.recommendationId).toBe('rec-1');
      expect(typeof res.body.auditTrailCount).toBe('number');
      expect(Array.isArray(res.body.auditTrail)).toBe(true);
    });
  });

  // ============================================================================
  // Approval Gate endpoints
  // ============================================================================

  describe('POST /cases/:caseId/documents/:documentId/approval-gate/open', () => {
    it('öppnar en godkännandeport', async () => {
      const res = await request(app).post('/cases/case-1/documents/doc-1/approval-gate/open').send({});

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.gate.id).toBe('gate-1');
    });
  });

  describe('PATCH /cases/:caseId/documents/:documentId/approval-gate/lock', () => {
    it('låser en godkännandeport', async () => {
      const res = await request(app)
        .patch('/cases/case-1/documents/doc-1/approval-gate/lock')
        .send({ lockedBy: 'handlaggare@gavle.se' });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.gate.status).toBe('LOCKED');
    });

    it('returnerar 400 om lockedBy saknas', async () => {
      const res = await request(app).patch('/cases/case-1/documents/doc-1/approval-gate/lock').send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('lockedBy');
    });
  });

  describe('PATCH /cases/:caseId/documents/:documentId/approval-gate/finalize', () => {
    it('slutför en godkännandeport', async () => {
      const res = await request(app).patch('/cases/case-1/documents/doc-1/approval-gate/finalize').send({});

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.gate.status).toBe('FINALIZED');
    });
  });

  describe('GET /cases/:caseId/documents/:documentId/approval-gate/status', () => {
    it('returnerar portens status och räkningar', async () => {
      const res = await request(app).get('/cases/case-1/documents/doc-1/approval-gate/status');

      expect(res.status).toBe(200);
      expect(res.body.caseId).toBe('case-1');
      expect(res.body.documentId).toBe('doc-1');
      expect(res.body.status).toBe('OPEN');
      expect(typeof res.body.pendingCount).toBe('number');
    });
  });
});
