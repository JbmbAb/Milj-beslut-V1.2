/**
 * createApp.test.ts
 *
 * Tests for the Express app factory — health endpoint, CORS, OPTIONS.
 */

import request from 'supertest';
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../server/db/prisma', () => ({
  prisma: {
    $queryRaw: vi.fn(async () => [{ '?column?': 1 }]),
    tokenRevocation: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async () => ({})),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    project: { findMany: vi.fn(async () => []) },
    documentRecord: { count: vi.fn(async () => 0) },
    metadataReviewQueue: { findMany: vi.fn(async () => []) },
  },
}));

vi.mock('../../server/repositories/userRepository', () => ({
  ensureAdminConsoleUser: vi.fn(async () => ({
    id: 'test-admin-id',
    bankidId: 'admin:admin',
    role: 'ADMIN',
    organisationId: 'test-org-id',
  })),
  findAuthUserByBankId: vi.fn(async () => null),
}));

import { createApp } from '../../server/createApp';
import { prisma } from '../../server/db/prisma';

describe('GET /health', () => {
  it('returns 200 liveness without DB', async () => {
    const app = createApp();
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.liveness).toBe('up');
    expect(res.body.service).toBe('miljobeslut-secure-backend');
    expect(typeof res.body.ts).toBe('string');
  });

  it('includes version field', async () => {
    const app = createApp();
    const res = await request(app).get('/health');
    expect(typeof res.body.version).toBe('string');
  });
});

describe('GET /ready', () => {
  beforeEach(() => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ '?column?': 1 }] as never);
  });

  it('returns 200 with ok=true when DB is reachable', async () => {
    const app = createApp();
    const res = await request(app).get('/ready');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.database).toBe('ok');
    expect(res.body.service).toBe('miljobeslut-secure-backend');
    expect(typeof res.body.ts).toBe('string');
  });

  it('returns 503 with ok=false when DB throws', async () => {
    vi.mocked(prisma.$queryRaw).mockRejectedValue(new Error('DB unreachable'));
    const app = createApp();
    const res = await request(app).get('/ready');

    expect(res.status).toBe(503);
    expect(res.body.ok).toBe(false);
    expect(res.body.database).toBe('error');
  });
});

describe('CORS middleware', () => {
  it('sets Access-Control-Allow-Origin when origin matches allowlist', async () => {
    process.env.CORS_ALLOW_ORIGINS = 'http://localhost:5173';
    const app = createApp();
    const res = await request(app).get('/health').set('Origin', 'http://localhost:5173');

    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    delete process.env.CORS_ALLOW_ORIGINS;
  });

  it('sets Access-Control-Allow-Origin to * when wildcard is configured', async () => {
    process.env.CORS_ALLOW_ORIGINS = '*';
    const app = createApp();
    const res = await request(app).get('/health').set('Origin', 'http://any-origin.example.com');

    expect(res.headers['access-control-allow-origin']).toBe('*');
    delete process.env.CORS_ALLOW_ORIGINS;
  });

  it('does NOT set CORS headers when origin is not in allowlist', async () => {
    process.env.CORS_ALLOW_ORIGINS = 'http://allowed.example.com';
    const app = createApp();
    const res = await request(app).get('/health').set('Origin', 'http://unauthorized.example.com');

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    delete process.env.CORS_ALLOW_ORIGINS;
  });

  it('responds 204 to OPTIONS preflight with CORS allowed', async () => {
    process.env.CORS_ALLOW_ORIGINS = 'http://localhost:5173';
    const app = createApp();
    const res = await request(app).options('/health').set('Origin', 'http://localhost:5173');

    expect(res.status).toBe(204);
    delete process.env.CORS_ALLOW_ORIGINS;
  });
});
