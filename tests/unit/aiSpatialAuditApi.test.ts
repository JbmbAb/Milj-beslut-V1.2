import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTokenPair } from '../../server/security/auth';

vi.mock('../../server/repositories/tokenRepository', () => ({
  isTokenRevoked: vi.fn(async () => false),
  markRefreshTokenAsUsed: vi.fn(async () => undefined),
  revokeRefreshToken: vi.fn(async () => undefined),
  cleanupExpiredTokenRevocations: vi.fn(async () => 0),
}));

const mocks = vi.hoisted(() => ({
  runSpatialAudit: vi.fn(),
}));

vi.mock('../../server/services/spatialAuditService', () => ({
  runSpatialAudit: mocks.runSpatialAudit,
}));

import aiAssistantRouter from '../../server/aiAssistantApi.express';

const app = express();
app.use(express.json());
app.use(aiAssistantRouter);

function authHeader() {
  return `Bearer ${
    createTokenPair({
      id: 'user-1',
      organisationId: 'org-1',
      bankidId: 'bankid-user-1',
      role: 'ADMIN',
    }).accessToken
  }`;
}

/**
 * U51-DYNAMIC-IMPORT-CLOSURE-01 B4: server API contract for the performSpatialAudit method. The result shape
 * is { text, sources } and the local spatial audit is the first source of truth on the server.
 */
describe('aiAssistantApi performSpatialAudit (server API contract)', () => {
  beforeEach(() => {
    mocks.runSpatialAudit.mockReset();
  });

  it('returns exactly { text, sources } from the local spatial audit', async () => {
    mocks.runSpatialAudit.mockResolvedValueOnce({
      text: 'audit-text',
      sources: [{ web: { uri: 'https://example.invalid/source', title: 'Källa' } }],
      extraField: 'must-not-leak',
    });

    const res = await request(app)
      .post('/api/ai-assistant')
      .set('Authorization', authHeader())
      .send({ method: 'performSpatialAudit', payload: { lat: 59.33, lng: 18.06 } });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.result).toEqual({
      text: 'audit-text',
      sources: [{ web: { uri: 'https://example.invalid/source', title: 'Källa' } }],
    });
    expect(mocks.runSpatialAudit).toHaveBeenCalledWith(59.33, 18.06);
  });

  it('reports a 500 with the unavailable message when the local audit fails and no generation is configured', async () => {
    mocks.runSpatialAudit.mockRejectedValueOnce(new Error('db down'));

    const res = await request(app)
      .post('/api/ai-assistant')
      .set('Authorization', authHeader())
      .send({ method: 'performSpatialAudit', payload: { lat: 59.33, lng: 18.06 } });

    expect(res.status).toBe(500);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toContain('Spatial audit saknar verifierad AI-källa');
  });
});
