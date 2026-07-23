import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTokenPair } from '../../server/security/auth';

// Setup Hoisted Mocks
const mocks = vi.hoisted(() => ({
  search: vi.fn(),
  createAIRecommendation: vi.fn(),
  getPendingRecommendationsForReview: vi.fn(),
  submitApprovalReview: vi.fn(),
}));

// Mock Token Repository for authentication
vi.mock('../../server/repositories/tokenRepository', () => ({
  isTokenRevoked: vi.fn(async () => false),
  markRefreshTokenAsUsed: vi.fn(async () => undefined),
  revokeRefreshToken: vi.fn(async () => undefined),
  cleanupExpiredTokenRevocations: vi.fn(async () => 0),
}));

// Mock searchService
vi.mock('../../server/services/searchService', () => {
  const { EventEmitter } = require('events');
  class MockAlphaevolveSearchService extends EventEmitter {
    public async search(query: string, options: any = {}) {
      return mocks.search(query, options);
    }
  }
  return {
    AlphaevolveSearchService: MockAlphaevolveSearchService,
  };
});

// Mock classification module / decisionFeedbackService
vi.mock('../../server/modules/classification/public', () => ({
  createAIRecommendation: mocks.createAIRecommendation,
  getPendingRecommendationsForReview: mocks.getPendingRecommendationsForReview,
  submitApprovalReview: mocks.submitApprovalReview,
}));

import searchRoutes from '../../server/routes/searchRoutes';
import recommendationRoutes from '../../server/routes/recommendationRoutes';

const app = express();
app.use(express.json());
app.use(searchRoutes);
app.use(recommendationRoutes);

function authHeader(role: 'ADMIN' | 'CONSULTANT' = 'ADMIN') {
  return `Bearer ${
    createTokenPair({
      id: role === 'ADMIN' ? 'admin-1' : 'user-1',
      organisationId: 'org-1',
      bankidId: role === 'ADMIN' ? 'admin:one' : 'consultant:one',
      role,
    }).accessToken
  }`;
}

describe('Alphaevolve Search and Recommendation Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/search', () => {
    it('returns 400 if query parameter is missing', async () => {
      const res = await request(app)
        .get('/api/search')
        .set('Authorization', authHeader('ADMIN'));

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Query parameter is required');
    });

    it('returns 400 for invalid bbox format', async () => {
      const res = await request(app)
        .get('/api/search')
        .query({ query: 'test', bbox: '1,2,3' })
        .set('Authorization', authHeader('ADMIN'));

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid bbox format');
    });

    it('correctly executes search with options and custom config parameters', async () => {
      mocks.search.mockResolvedValue([
        {
          id: 'chunk-1',
          chunkText: 'Sample chunk',
          documentId: 'doc-1',
          documentTitle: 'Document 1',
          finalScore: 0.95,
        },
      ]);

      const res = await request(app)
        .get('/api/search')
        .query({
          query: 'Miljöfarlig verksamhet',
          category: 'Vatten',
          bbox: '18.0,59.3,18.1,59.4',
          rrf_k: '50',
          rerank: 'true',
        })
        .set('Authorization', authHeader('ADMIN'));

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.results).toHaveLength(1);
      expect(res.body.results[0].id).toBe('chunk-1');

      expect(mocks.search).toHaveBeenCalledWith('Miljöfarlig verksamhet', {
        category: 'Vatten',
        bbox: [18.0, 59.3, 18.1, 59.4],
        config: {
          RRF_K: 50,
          CROSS_ENCODER_ENABLED: true,
        },
      });
    });
  });

  describe('POST /api/recommendations/recommend', () => {
    it('validates fields and calls createAIRecommendation', async () => {
      mocks.createAIRecommendation.mockResolvedValue({ id: 'recommend-1' });

      const payload = {
        caseId: 'case-123',
        documentId: 'doc-456',
        aiClassification: 'PERMIT_REQUIRED',
        sourceDocumentHash: 'abc',
        sourceTextSegment: 'test',
        aiConfidence: 'HIGH',
      };

      const res = await request(app)
        .post('/api/recommendations/recommend')
        .set('Authorization', authHeader('ADMIN'))
        .send(payload);

      expect(res.status).toBe(201);
      expect(res.body.ok).toBe(true);
      expect(res.body.recommendation.id).toBe('recommend-1');
      expect(mocks.createAIRecommendation).toHaveBeenCalledWith(payload);
    });

    it('returns 400 if required fields are missing', async () => {
      const res = await request(app)
        .post('/api/recommendations/recommend')
        .set('Authorization', authHeader('ADMIN'))
        .send({ caseId: 'case-1' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Missing required fields');
    });
  });

  describe('GET /api/cases/:caseId/pending-reviews', () => {
    it('retrieves pending reviews', async () => {
      mocks.getPendingRecommendationsForReview.mockResolvedValue([{ id: 'rec-1' }]);

      const res = await request(app)
        .get('/api/cases/case-123/pending-reviews')
        .set('Authorization', authHeader('ADMIN'));

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.pendingCount).toBe(1);
      expect(res.body.recommendations).toHaveLength(1);
      expect(mocks.getPendingRecommendationsForReview).toHaveBeenCalledWith('case-123');
    });
  });

  describe('POST /api/recommendations/:recommendationId/submit-review', () => {
    it('submits human review successfully', async () => {
      mocks.submitApprovalReview.mockResolvedValue({ id: 'rec-1', status: 'APPROVED' });

      const res = await request(app)
        .post('/api/recommendations/rec-1/submit-review')
        .set('Authorization', authHeader('ADMIN'))
        .send({
          decision: 'APPROVED',
          reviewedBy: 'John Doe',
          reviewNotes: 'Valid',
        });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.decision).toBe('APPROVED');
      expect(mocks.submitApprovalReview).toHaveBeenCalledWith({
        recommendationId: 'rec-1',
        decision: 'APPROVED',
        reviewedBy: 'John Doe',
        reviewNotes: 'Valid',
        appliedWithChanges: undefined,
        changesNotes: undefined,
      });
    });

    it('validates decision types and reviewedBy', async () => {
      const res = await request(app)
        .post('/api/recommendations/rec-1/submit-review')
        .set('Authorization', authHeader('ADMIN'))
        .send({
          decision: 'INVALID_STATUS',
          reviewedBy: 'John Doe',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid decision');
    });
  });
});
