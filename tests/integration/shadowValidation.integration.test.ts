import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../server/createApp';
import { prisma } from '../../server/db/prisma';
import { authRequest, loginAsAdmin } from '../helpers/integrationAuth';
import { describeIfDatabaseIntegration } from './integrationTestEnv';
import { signJwt } from '../../server/security/auth';
import { getEnv } from '../../server/security/env';

const app = createApp();

function generateUserToken(): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: 'test-user-id',
    organisationId: 'test-org-id',
    bankidId: 'test-bankid-id',
    role: 'USER' as const,
    type: 'access' as const,
    jti: 'test-jti',
    iat: now,
    exp: now + 3600,
  };
  return signJwt(payload, getEnv('JWT_ACCESS_SECRET'));
}

describeIfDatabaseIntegration('Shadow Validation & Telemetry Integration', () => {
  let adminToken = '';
  let userToken = '';

  beforeAll(async () => {
    adminToken = await loginAsAdmin();
    userToken = generateUserToken();
    // Clear out any old rate limits from previous tests for a clean slate
    await prisma.$executeRaw`DELETE FROM "RateLimitEntry"`;
  });

  afterAll(async () => {
    await prisma.$executeRaw`DELETE FROM "RateLimitEntry"`.catch(() => undefined);
    await prisma.$disconnect();
  });

  describe('POST /api/legal/search - Authorization', () => {
    it('returns 401 if unauthorized', async () => {
      const res = await request(app).post('/api/legal/search').send({ query: 'strandskydd' });
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/legal/search - Query Length Validation', () => {
    it('returns 400 if query is too short', async () => {
      const res = await authRequest(adminToken).post('/api/legal/search').send({ query: 'a' });
      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
      expect(res.body.error).toContain('kort');
    });
  });

  describe('POST /api/legal/search - Search Metrics & Shadow Validation', () => {
    it('returns search results and robust metadata', async () => {
      const res = await authRequest(adminToken).post('/api/legal/search').send({ query: 'strandskydd' });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(Array.isArray(res.body.results)).toBe(true);

      const meta = res.body.meta;
      expect(meta).toBeDefined();

      // Telemetry (A2): High-precision latencies present in meta
      expect(typeof meta.latencyMs).toBe('number');
      expect(typeof meta.exactMs).toBe('number');
      expect(typeof meta.ftsMs).toBe('number');
      expect(typeof meta.vectorMs).toBe('number');
      expect(typeof meta.rrfMs).toBe('number');
      expect(typeof meta.totalMs).toBe('number');

      // Shadow Validation (A6): Advanced shadow metrics present in meta
      expect(meta.shadowChangedTop1).toBeDefined();
      expect(meta.shadowChangedTop5).toBeDefined();
      expect(typeof meta.shadowScoreDelta).toBe('number');
      expect(typeof meta.kendallTau).toBe('number');
      expect(typeof meta.ndcg5).toBe('number');
      expect(typeof meta.mrr).toBe('number');
      expect(typeof meta.recall10).toBe('number');

      // Quality KPIs: Municipal counts and scores
      expect(typeof meta.municipalDecisionCount).toBe('number');
      expect(typeof meta.municipalDecisionTopScore).toBe('number');
    });
  });

  describe('POST /api/legal/search - Rate Limiting', () => {
    it('blocks requests and returns 429 when user rate limit is exceeded', async () => {
      // Clear out RateLimitEntry to ensure no spillover
      await prisma.$executeRaw`DELETE FROM "RateLimitEntry"`;

      let lastStatus = 200;
      let blocked = false;

      // Rate limit is set to 30 requests per minute
      for (let i = 0; i < 35; i++) {
        const res = await authRequest(userToken).post('/api/legal/search').send({ query: 'strandskydd' });

        lastStatus = res.status;
        if (res.status === 429) {
          blocked = true;
          break;
        }
      }

      expect(blocked).toBe(true);
      expect(lastStatus).toBe(429);
    });
  });
});
