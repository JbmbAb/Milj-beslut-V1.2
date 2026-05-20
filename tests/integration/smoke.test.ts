/**
 * Smoke Tests – Miljöbeslut API
 *
 * Verifierar att alla kritiska endpoints svarar utan 500-fel.
 * Kräver INGEN live-databas — Prisma mockas minimalt.
 *
 * Kör: npx vitest run --project integration tests/integration/smoke.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

// ── Prisma mock (förhindrar att appen försöker nå databasen vid boot) ─────────
vi.mock('@prisma/client', async () => {
  const prismaStub = {
    $connect: vi.fn().mockResolvedValue(undefined),
    $disconnect: vi.fn().mockResolvedValue(undefined),
    $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
    $queryRawUnsafe: vi.fn().mockResolvedValue([]),
    user: { findUnique: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
    project: { findUnique: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
    auditLog: { create: vi.fn().mockResolvedValue({}), findMany: vi.fn().mockResolvedValue([]) },
    rateLimitRecord: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn().mockResolvedValue({}) },
    token: { findUnique: vi.fn().mockResolvedValue(null) },
    backgroundJob: { findMany: vi.fn().mockResolvedValue([]) },
  };
  return {
    PrismaClient: vi.fn(() => prismaStub),
    Prisma: { sql: vi.fn(), empty: null, PrismaClientKnownRequestError: class extends Error {} },
  };
});

// Mocka externa AI-tjänster så de inte kraschar vid import
vi.mock('@google-cloud/vertexai', () => ({
  VertexAI: vi.fn(() => ({
    getGenerativeModel: vi.fn(() => ({ generateContent: vi.fn() })),
  })),
}));
vi.mock('google-auth-library', () => ({ GoogleAuth: vi.fn(() => ({})) }));
vi.mock('@sentry/node', () => ({
  init: vi.fn(),
  setupExpressErrorHandler: vi.fn(),
  withScope: vi.fn(),
  captureException: vi.fn(),
}));

import { createApp } from '../../server/createApp';

let app: Express;

beforeAll(() => {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'smoke-test-secret-minimum-32-chars!!';
  process.env.DATABASE_URL = 'postgresql://mock:mock@localhost:5432/mock';
  app = createApp();
});

afterAll(() => {
  // Noop – ingen riktig DB att koppla ner
});

// ── Liveness & Readiness ──────────────────────────────────────────────────────

describe('GET /health', () => {
  it('svarar 200 med ok:true', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.service).toBe('miljobeslut-secure-backend');
  });
});

describe('GET /ready', () => {
  it('svarar 200 eller 503 (aldrig 500)', async () => {
    const res = await request(app).get('/ready');
    expect([200, 503]).toContain(res.status);
    expect(res.body).toHaveProperty('service');
    expect(res.body).toHaveProperty('ts');
  });
});

// ── Auth-endpoints (inga autentiseringsuppgifter → 400/401) ──────────────────

describe('POST /api/v1/auth/login', () => {
  it('svarar 400 eller 401 (aldrig 404/500)', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: '', password: '' });
    expect([400, 401, 422]).toContain(res.status);
  });
});

describe('POST /api/v1/auth/refresh', () => {
  it('svarar 400 eller 401 utan giltig token', async () => {
    const res = await request(app).post('/api/v1/auth/refresh').send({});
    expect([400, 401, 403]).toContain(res.status);
  });
});

// ── CSRF-token ────────────────────────────────────────────────────────────────

describe('GET /api/csrf-token', () => {
  it('svarar 200 med csrfToken', async () => {
    const res = await request(app).get('/api/csrf-token');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('csrfToken');
  });
});

// ── Skyddade endpoints (kräver auth → 401) ────────────────────────────────────

const protectedGetEndpoints = [
  '/api/v1/projects',
  '/api/admin/projects',
  '/api/v1/search',
  '/api/v1/datasources',
  '/api/v1/gdpr/status',
  '/api/v1/reference/municipalities',
  '/api/gis/layers',
];

describe('Skyddade GET-endpoints', () => {
  for (const endpoint of protectedGetEndpoints) {
    it(`${endpoint} svarar 401 utan token (aldrig 500)`, async () => {
      const res = await request(app).get(endpoint);
      expect([401, 403]).toContain(res.status);
    });
  }
});

const protectedPostEndpoints = [
  '/api/v1/projects',
  '/api/admin/projects',
  '/api/v1/search/property',
  '/api/bank-compliance/report',
  '/api/erp/sync',
];

describe('Skyddade POST-endpoints', () => {
  for (const endpoint of protectedPostEndpoints) {
    it(`${endpoint} svarar 401 utan token (aldrig 500)`, async () => {
      const res = await request(app).post(endpoint).send({});
      expect([401, 403, 400]).toContain(res.status);
    });
  }
});

// ── Kända publika endpoints ───────────────────────────────────────────────────

describe('GET /metrics', () => {
  it('svarar 200 eller 503 (aldrig 500)', async () => {
    const res = await request(app).get('/metrics');
    expect([200, 503]).toContain(res.status);
  });
});

// ── 404-hantering ─────────────────────────────────────────────────────────────

describe('Okänd route', () => {
  it('GET /api/okänd-route svarar 404', async () => {
    const res = await request(app).get('/api/okänd-route-som-inte-existerar');
    expect(res.status).toBe(404);
  });
});
