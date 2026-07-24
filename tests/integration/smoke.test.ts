import { prisma } from '../../server/db/prisma';
/**
 * Smoke Tests – Miljöbeslut API (riktig test-DB, inga Prisma-mocks)
 *
 * Verifierar liveness, auth-gates och att kritiska routes inte kraschar med 500.
 *
 * Kör: npm run test:smoke
 */
import { afterAll, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

import { createApp } from '../../server/createApp';
import { describeIfDatabaseIntegration } from './integrationTestEnv';

const app: Express = createApp();

afterAll(async () => {
  await prisma.$disconnect();
});

describeIfDatabaseIntegration('Smoke – liveness & readiness', () => {
  it('GET /health svarar 200 med ok:true', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.service).toBe('miljobeslut-secure-backend');
  });

  it('GET /ready svarar 200/503 (aldrig 500)', async () => {
    const res = await request(app).get('/ready');
    expect([200, 503]).toContain(res.status);
    expect(res.body).toHaveProperty('service');
    expect(res.body).toHaveProperty('ts');
    expect(res.status).not.toBe(500);
  });
});

describeIfDatabaseIntegration('Smoke – auth-endpoints', () => {
  it('POST /api/admin/auth/login svarar 400/401 med tom body (aldrig 500)', async () => {
    const res = await request(app).post('/api/admin/auth/login').send({ username: '', password: '' });
    expect([400, 401, 422]).toContain(res.status);
    expect(res.status).not.toBe(500);
  });

  it('POST /api/auth/refresh svarar 401/403 med ogiltig token (aldrig 500)', async () => {
    const res = await request(app).post('/api/auth/refresh').send({ refreshToken: 'not-a-valid-jwt-token' });
    expect([401, 403]).toContain(res.status);
    expect(res.status).not.toBe(500);
  });
});

describeIfDatabaseIntegration('Smoke – CSRF', () => {
  it('GET /api/csrf-token svarar 200 med csrfToken', async () => {
    const res = await request(app).get('/api/csrf-token');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('csrfToken');
  });
});

const protectedGetEndpoints = [
  '/api/v1/projects',
  '/api/admin/projects',
  '/api/admin/requirements/cases',
  '/api/sewage-applications',
  '/api/search/info',
  '/api/permits',
];

describeIfDatabaseIntegration('Smoke – skyddade GET-endpoints', () => {
  for (const endpoint of protectedGetEndpoints) {
    it(`${endpoint} svarar 401/403 utan token (aldrig 500)`, async () => {
      const res = await request(app).get(endpoint);
      expect([401, 403]).toContain(res.status);
      expect(res.status).not.toBe(500);
    });
  }
});

const protectedPostEndpoints = ['/api/admin/projects', '/api/sewage/applications', '/api/spatial-audit'];

describeIfDatabaseIntegration('Smoke – skyddade POST-endpoints', () => {
  for (const endpoint of protectedPostEndpoints) {
    it(`${endpoint} svarar 401/403/400 utan token (aldrig 500)`, async () => {
      const res = await request(app).post(endpoint).send({});
      expect([401, 403, 400]).toContain(res.status);
      expect(res.status).not.toBe(500);
    });
  }
});

describeIfDatabaseIntegration('Smoke – metrics & 404', () => {
  it('GET /metrics svarar 200/503 (aldrig 500)', async () => {
    const res = await request(app).get('/metrics');
    expect([200, 503]).toContain(res.status);
    expect(res.status).not.toBe(500);
  });

  it('GET /api/okänd-route svarar 404', async () => {
    const res = await request(app).get('/api/okänd-route-som-inte-existerar');
    expect(res.status).toBe(404);
  });
});
