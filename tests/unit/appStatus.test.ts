import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createTokenPair } from '../../server/security/auth';
import { createApp } from '../../server/createApp';
import type { AppStatusResponse } from '../../types';

vi.mock('../../server/repositories/userRepository', () => ({
  ensureAdminConsoleUser: vi.fn(async () => ({
    id: 'test-admin-id',
    bankidId: 'admin:admin',
    role: 'ADMIN',
    organisationId: 'test-org-id',
  })),
  findAuthUserByBankId: vi.fn(async () => null),
}));

vi.mock('../../server/repositories/tokenRepository', () => ({
  isTokenRevoked: vi.fn(async () => false),
  markRefreshTokenAsUsed: vi.fn(async () => undefined),
  revokeRefreshToken: vi.fn(async () => undefined),
  cleanupExpiredTokenRevocations: vi.fn(async () => 0),
}));

const mockStatus: AppStatusResponse = {
  checkedAt: new Date().toISOString(),
  overall: 'ok',
  app: {
    status: 'ok',
    version: '1.0.0',
    uptimeSeconds: 3725,
    environment: 'test',
  },
  db: {
    status: 'ok',
    latencyMs: 4,
  },
  datasources: {
    total: 6,
    connected: 5,
    errors: 0,
    permitRequired: 1,
    allOpenSourcesActive: true,
  },
};

vi.mock('../../server/repositories/adminReportRepository', () => ({
  getAdminExamSummary: vi.fn(),
  getAdminDatabaseDump: vi.fn(),
  getDbStats: vi.fn(),
  getDbAnalysis: vi.fn(),
  getDbContents: vi.fn(),
  getExternalHealth: vi.fn(),
  getAppStatus: vi.fn(async () => mockStatus),
}));

const app = createApp();

function adminAuthHeader() {
  const token = createTokenPair({
    id: 'test-admin-id',
    organisationId: 'test-org-id',
    bankidId: 'admin:admin',
    role: 'ADMIN',
  }).accessToken;
  return `Bearer ${token}`;
}

function consultantAuthHeader() {
  const token = createTokenPair({
    id: 'test-user-id',
    organisationId: 'test-org-id',
    bankidId: 'bankid:user',
    role: 'CONSULTANT',
  }).accessToken;
  return `Bearer ${token}`;
}

describe('GET /api/admin/app-status', () => {
  it('returns 401 without auth token', async () => {
    const res = await request(app).get('/api/admin/app-status');
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin users', async () => {
    const res = await request(app).get('/api/admin/app-status').set('Authorization', consultantAuthHeader());
    expect(res.status).toBe(403);
  });

  it('returns 200 with ok=true for admin', async () => {
    const res = await request(app).get('/api/admin/app-status').set('Authorization', adminAuthHeader());
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('response has correct top-level shape', async () => {
    const res = await request(app).get('/api/admin/app-status').set('Authorization', adminAuthHeader());
    const s = res.body.status as AppStatusResponse;
    expect(typeof s.checkedAt).toBe('string');
    expect(['ok', 'degraded', 'error']).toContain(s.overall);
    expect(s.app).toBeDefined();
    expect(s.db).toBeDefined();
    expect(s.datasources).toBeDefined();
  });

  it('app section has required fields', async () => {
    const res = await request(app).get('/api/admin/app-status').set('Authorization', adminAuthHeader());
    const s = res.body.status as AppStatusResponse;
    expect(['ok', 'error']).toContain(s.app.status);
    expect(typeof s.app.version).toBe('string');
    expect(typeof s.app.uptimeSeconds).toBe('number');
    expect(typeof s.app.environment).toBe('string');
  });

  it('db section has required fields', async () => {
    const res = await request(app).get('/api/admin/app-status').set('Authorization', adminAuthHeader());
    const s = res.body.status as AppStatusResponse;
    expect(['ok', 'error']).toContain(s.db.status);
    expect(s.db.latencyMs === null || typeof s.db.latencyMs === 'number').toBe(true);
  });

  it('datasources section has required fields', async () => {
    const res = await request(app).get('/api/admin/app-status').set('Authorization', adminAuthHeader());
    const s = res.body.status as AppStatusResponse;
    expect(typeof s.datasources.total).toBe('number');
    expect(typeof s.datasources.connected).toBe('number');
    expect(typeof s.datasources.errors).toBe('number');
    expect(typeof s.datasources.permitRequired).toBe('number');
    expect(typeof s.datasources.allOpenSourcesActive).toBe('boolean');
  });

  it('returns mock data values correctly', async () => {
    const res = await request(app).get('/api/admin/app-status').set('Authorization', adminAuthHeader());
    const s = res.body.status as AppStatusResponse;
    expect(s.overall).toBe('ok');
    expect(s.app.version).toBe('1.0.0');
    expect(s.app.uptimeSeconds).toBe(3725);
    expect(s.db.status).toBe('ok');
    expect(s.db.latencyMs).toBe(4);
    expect(s.datasources.total).toBe(6);
    expect(s.datasources.connected).toBe(5);
    expect(s.datasources.allOpenSourcesActive).toBe(true);
  });
});
