import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTokenPair } from '../../server/security/auth';

vi.mock('../../server/repositories/tokenRepository', () => ({
  isTokenRevoked: vi.fn(async () => false),
  markRefreshTokenAsUsed: vi.fn(async () => undefined),
  revokeRefreshToken: vi.fn(async () => undefined),
}));

const mocks = vi.hoisted(() => ({
  createAIRecommendation: vi.fn(),
  getPendingRecommendationsForReview: vi.fn(),
  submitApprovalReview: vi.fn(),
}));

vi.mock('../../server/modules/classification/public', () => ({
  createAIRecommendation: mocks.createAIRecommendation,
  getPendingRecommendationsForReview: mocks.getPendingRecommendationsForReview,
  submitApprovalReview: mocks.submitApprovalReview,
}));

vi.mock('../../server/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import recommendationRoutes from '../../server/routes/recommendationRoutes';

const app = express();
app.use(express.json());
app.use(recommendationRoutes);
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'error' });
});

function authHeader(userId = 'reviewer-1') {
  return `Bearer ${
    createTokenPair({
      id: userId,
      organisationId: 'org-1',
      bankidId: 'bankid:reviewer-1',
      role: 'CONSULTANT',
    }).accessToken
  }`;
}

const mockRecommendation = {
  id: 'rec-1',
  caseId: 'case-1',
  documentId: 'doc-1',
  aiClassification: 'MILJÖFARLIG_VERKSAMHET',
  status: 'SUGGESTED',
  createdAt: new Date().toISOString(),
};

describe('recommendationRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createAIRecommendation.mockResolvedValue(mockRecommendation);
    mocks.getPendingRecommendationsForReview.mockResolvedValue([mockRecommendation]);
    mocks.submitApprovalReview.mockResolvedValue({ ...mockRecommendation, status: 'APPROVED' });
  });

  describe('POST /api/recommendations/recommend', () => {
    it('kräver autentisering', async () => {
      const res = await request(app).post('/api/recommendations/recommend').send({
        caseId: 'case-1',
        documentId: 'doc-1',
        aiClassification: 'RISK',
      });

      expect(res.status).toBe(401);
    });

    it('skapar en AI-rekommendation för en autentiserad användare', async () => {
      const res = await request(app)
        .post('/api/recommendations/recommend')
        .set('Authorization', authHeader())
        .send({ caseId: 'case-1', documentId: 'doc-1', aiClassification: 'RISK' });

      expect(res.status).toBe(201);
      expect(res.body.ok).toBe(true);
      expect(res.body.recommendation.id).toBe('rec-1');
    });

    it('returnerar 400 om obligatoriska fält saknas', async () => {
      const res = await request(app)
        .post('/api/recommendations/recommend')
        .set('Authorization', authHeader())
        .send({ caseId: 'case-1' });

      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/cases/:caseId/pending-reviews', () => {
    it('kräver autentisering', async () => {
      const res = await request(app).get('/api/cases/case-1/pending-reviews');
      expect(res.status).toBe(401);
    });

    it('returnerar väntande granskningar för en autentiserad användare', async () => {
      const res = await request(app)
        .get('/api/cases/case-1/pending-reviews')
        .set('Authorization', authHeader());

      expect(res.status).toBe(200);
      expect(res.body.pendingCount).toBe(1);
    });
  });

  describe('POST /api/recommendations/:recommendationId/submit-review', () => {
    it('kräver autentisering', async () => {
      const res = await request(app)
        .post('/api/recommendations/rec-1/submit-review')
        .send({ decision: 'APPROVED' });

      expect(res.status).toBe(401);
      expect(mocks.submitApprovalReview).not.toHaveBeenCalled();
    });

    it('returnerar 400 för ogiltigt beslut', async () => {
      const res = await request(app)
        .post('/api/recommendations/rec-1/submit-review')
        .set('Authorization', authHeader())
        .send({ decision: 'NOT_A_REAL_DECISION' });

      expect(res.status).toBe(400);
    });

    it('godkänner en rekommendation för den autentiserade användaren', async () => {
      const res = await request(app)
        .post('/api/recommendations/rec-1/submit-review')
        .set('Authorization', authHeader('reviewer-1'))
        .send({ decision: 'APPROVED', reviewNotes: 'ok' });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(mocks.submitApprovalReview).toHaveBeenCalledWith(
        expect.objectContaining({ recommendationId: 'rec-1', decision: 'APPROVED', reviewedBy: 'reviewer-1' }),
      );
    });

    // HD-05 (SAG-21): reviewedBy must come from the authenticated session, never from a
    // client-supplied body field -- otherwise any authenticated user could approve another
    // tenant's recommendation under a forged reviewer name.
    it('sätter reviewedBy till den autentiserade användaren, oavsett vad body påstår', async () => {
      const res = await request(app)
        .post('/api/recommendations/rec-1/submit-review')
        .set('Authorization', authHeader('reviewer-1'))
        .send({ decision: 'APPROVED', reviewedBy: 'forged-reviewer@evil.example' });

      expect(res.status).toBe(200);
      expect(mocks.submitApprovalReview).toHaveBeenCalledWith(
        expect.objectContaining({ reviewedBy: 'reviewer-1' }),
      );
    });
  });
});
