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

/**
 * W3b -- C2 (OD-04): the `analyzeBiodiversity` dispatch case wraps all four upstream fetches (SLU
 * species, NVR protected areas, SGU geology, RAA monuments) in a single shared try/catch that logs
 * and swallows any failure, then unconditionally calls `analyzeBiodiversityWithCompliance()` with
 * whatever came back -- indistinguishable from a genuinely-empty, checked result. This proves the
 * fix: an `unavailableSources` array naming exactly which upstream source(s) failed.
 */

vi.mock('../../server/services/sluService', () => ({
  searchSluByCoordinates: vi.fn(),
}));
vi.mock('../../server/services/nvrService', () => ({
  fetchProtectedAreas: vi.fn(async () => []),
}));
vi.mock('../../server/services/sguService', () => ({
  fetchGeologicalData: vi.fn(async () => ({ soilType: 'Sand', groundwaterVulnerability: 'Låg' })),
}));
vi.mock('../../server/services/raaService', () => ({
  fetchAncientMonuments: vi.fn(async () => []),
}));
vi.mock('../../server/services/geminiBiodiversityService', () => ({
  analyzeBiodiversityWithCompliance: vi.fn(async () => ({
    observations: [],
    protectedAreas: [],
    summary: 'stub-summary',
  })),
}));

import { searchSluByCoordinates } from '../../server/services/sluService';
import geminiRouter from '../../server/geminiApi.express';

const app = express();
app.use(express.json());
app.use(geminiRouter);

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

describe('W3b: geminiApi.express analyzeBiodiversity reports which upstream source failed', () => {
  beforeEach(() => {
    vi.mocked(searchSluByCoordinates).mockReset();
  });

  it('names the SLU source in unavailableSources when the SLU fetch throws, leaves the other three out', async () => {
    vi.mocked(searchSluByCoordinates).mockRejectedValueOnce(new Error('SLU down'));

    const res = await request(app)
      .post('/api/gemini')
      .set('Authorization', authHeader())
      .send({ method: 'analyzeBiodiversity', payload: { lat: 59.33, lng: 18.06, projectId: 'p1' } });

    expect(res.status).toBe(200);
    expect(res.body.result.unavailableSources).toEqual(['slu-observations-unavailable']);
  });

  it('reports an empty unavailableSources array when all four upstream fetches succeed', async () => {
    vi.mocked(searchSluByCoordinates).mockResolvedValueOnce({ records: [] } as any);

    const res = await request(app)
      .post('/api/gemini')
      .set('Authorization', authHeader())
      .send({ method: 'analyzeBiodiversity', payload: { lat: 59.33, lng: 18.06, projectId: 'p1' } });

    expect(res.status).toBe(200);
    expect(res.body.result.unavailableSources).toEqual([]);
  });
});
