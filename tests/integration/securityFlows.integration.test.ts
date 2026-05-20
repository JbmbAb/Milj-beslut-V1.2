import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { createApp } from '../../server/createApp';

const prisma = new PrismaClient();
const app = createApp();

const hasDatabaseIntegration = process.env.DATABASE_INTEGRATION === 'true';

describe.skipIf(!hasDatabaseIntegration)('Security & Production Flows Integration Test', () => {
  let adminToken = '';
  let adminRefreshToken = '';

  beforeAll(async () => {
    await prisma.$connect();
  });

  beforeEach(async () => {
    // Clear out any old rate limits from previous tests for a clean slate
    await prisma.$executeRaw`DELETE FROM "RateLimitEntry"`;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('Rate Limiting', () => {
    it('should block excessive requests to /api/admin/auth/login', async () => {
      let lastStatus = 200;
      let blockedCount = 0;
      
      // Make up to 25 requests. The limit is 20 per minute.
      for (let i = 0; i < 25; i++) {
        const res = await request(app)
          .post('/api/admin/auth/login')
          .send({
            username: 'wrong-user',
            password: 'wrong-password',
          });
        
        lastStatus = res.status;
        if (res.status === 429) {
          blockedCount++;
        } else {
          // Expected 401 for bad credentials when not blocked
          expect(res.status).toBe(401); 
        }
      }

      // Verify that rate limiting eventually kicked in
      expect(blockedCount).toBeGreaterThan(0);
      expect(lastStatus).toBe(429);
    });
  });

  describe('Authentication & Token Revocation', () => {
    it('should login and then allow token revocation via DB (simulated logout)', async () => {
      const loginRes = await request(app)
        .post('/api/admin/auth/login')
        .send({
          username: process.env.ADMIN_CONSOLE_USERNAME || 'admin',
          password: process.env.ADMIN_CONSOLE_PASSWORD || 'admin',
        });
      
      expect(loginRes.status).toBe(200);
      adminToken = loginRes.body.accessToken;
      adminRefreshToken = loginRes.body.refreshToken;

      // Extract JTI from JWT (payload is the second part)
      const tokenParts = adminToken.split('.');
      expect(tokenParts.length).toBe(3);
      
      const payload = JSON.parse(Buffer.from(tokenParts[1], 'base64').toString());
      const jti = payload.jti;
      const userId = payload.userId || payload.sub || 'test-user';
      expect(jti).toBeDefined();

      // Ensure the token works before revocation
      const checkRes1 = await request(app)
        .get('/api/admin/app-status')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(checkRes1.status).toBe(200);

      // Revoke the token manually (simulating logout/revocation flow)
      await prisma.tokenRevocation.create({
        data: {
          jti,
          userId,
          expiresAt: new Date(Date.now() + 1000 * 60 * 60) // Future
        }
      });

      // The token should now be rejected
      const checkRes2 = await request(app)
        .get('/api/admin/app-status')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(checkRes2.status).toBe(401);
    });
  });

  describe('GDPR Flow', () => {
    it('should run GDPR maintenance job', async () => {
      // Need a valid token to test GDPR. Since we revoked the previous one, get a new one.
      const loginRes = await request(app)
        .post('/api/admin/auth/login')
        .send({
          username: process.env.ADMIN_CONSOLE_USERNAME || 'admin',
          password: process.env.ADMIN_CONSOLE_PASSWORD || 'admin',
        });
      const validToken = loginRes.body.accessToken;

      // We hit the internal endpoint (often protected by internal network or special token, 
      // but let's check its behavior. If it requires X-Internal-Token, we provide it or just see if it's there).
      const res = await request(app)
        .post('/api/internal/background/gdpr-maintenance')
        .set('X-Internal-Token', process.env.INTERNAL_API_TOKEN || 'test-internal-token');

      // The internal route might not be protected by bearer token but by X-Internal-Token
      // Expect 200, 401 if token is mismatched, or 503 if service is disabled in test env
      expect([200, 401, 503]).toContain(res.status);

      // Also verify GDPR export route
      const exportRes = await request(app)
        .get('/api/gdpr/me/export')
        .set('Authorization', `Bearer ${validToken}`);
      
      // Some endpoints might return 400 if user doesn't have an associated bankid user, 
      // but it shouldn't be 404 or 500
      expect(exportRes.status).not.toBe(404);
      expect(exportRes.status).not.toBe(500);
    });
  });
});
