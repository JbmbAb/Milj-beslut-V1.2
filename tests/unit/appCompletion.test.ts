import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createTokenPair } from '../../server/security/auth';
import { createApp } from '../../server/createApp';
import type { AppCompletionResponse } from '../../types';

vi.mock('../../server/repositories/userRepository', () => ({
  ensureAdminConsoleUser: vi.fn(async () => ({
    id: 'test-admin-id',
    bankidId: 'admin:admin',
    role: 'ADMIN',
    organisationId: 'test-org-id',
  })),
  findAuthUserByBankId: vi.fn(async () => null),
}));

vi.mock('../../server/repositories/adminReportRepository', () => {
  const mockCompletion: AppCompletionResponse = {
    checkedAt: new Date().toISOString(),
    donePercent: 70,
    remainingPercent: 30,
    counts: { total: 60, done: 42, partial: 10, pending: 8 },
    categories: [
      {
        name: 'Autentisering',
        total: 4,
        done: 3,
        partial: 1,
        pending: 0,
        percent: 88,
        features: [
          { id: 'auth-bankid', label: 'BankID', category: 'Autentisering', status: 'DONE' },
        ],
      },
    ],
  };
  return {
    getAdminExamSummary: vi.fn(),
    getAdminDatabaseDump: vi.fn(),
    getDbStats: vi.fn(),
    getDbAnalysis: vi.fn(),
    getDbContents: vi.fn(),
    getExternalHealth: vi.fn(),
    getAppStatus: vi.fn(),
    getAppCompletion: vi.fn(async () => mockCompletion),
  };
});

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

describe('GET /api/admin/completion', () => {
  it('returns 401 without auth token', async () => {
    const res = await request(app).get('/api/admin/completion');
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin users', async () => {
    const res = await request(app)
      .get('/api/admin/completion')
      .set('Authorization', consultantAuthHeader());
    expect(res.status).toBe(403);
  });

  it('returns 200 with ok=true for admin', async () => {
    const res = await request(app)
      .get('/api/admin/completion')
      .set('Authorization', adminAuthHeader());
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('response has correct top-level shape', async () => {
    const res = await request(app)
      .get('/api/admin/completion')
      .set('Authorization', adminAuthHeader());
    const c = res.body.completion as AppCompletionResponse;
    expect(typeof c.checkedAt).toBe('string');
    expect(typeof c.donePercent).toBe('number');
    expect(typeof c.remainingPercent).toBe('number');
    expect(c.counts).toBeDefined();
    expect(Array.isArray(c.categories)).toBe(true);
  });

  it('donePercent + remainingPercent equals 100', async () => {
    const res = await request(app)
      .get('/api/admin/completion')
      .set('Authorization', adminAuthHeader());
    const c = res.body.completion as AppCompletionResponse;
    expect(c.donePercent + c.remainingPercent).toBe(100);
  });

  it('counts section has required fields', async () => {
    const res = await request(app)
      .get('/api/admin/completion')
      .set('Authorization', adminAuthHeader());
    const c = res.body.completion as AppCompletionResponse;
    expect(typeof c.counts.total).toBe('number');
    expect(typeof c.counts.done).toBe('number');
    expect(typeof c.counts.partial).toBe('number');
    expect(typeof c.counts.pending).toBe('number');
  });

  it('categories contain features with required fields', async () => {
    const res = await request(app)
      .get('/api/admin/completion')
      .set('Authorization', adminAuthHeader());
    const c = res.body.completion as AppCompletionResponse;
    expect(c.categories.length).toBeGreaterThan(0);
    const cat = c.categories[0];
    expect(typeof cat.name).toBe('string');
    expect(typeof cat.percent).toBe('number');
    expect(Array.isArray(cat.features)).toBe(true);
    const feat = cat.features[0];
    expect(typeof feat.id).toBe('string');
    expect(typeof feat.label).toBe('string');
    expect(['DONE', 'PARTIAL', 'PENDING']).toContain(feat.status);
  });

  it('returns mock values correctly', async () => {
    const res = await request(app)
      .get('/api/admin/completion')
      .set('Authorization', adminAuthHeader());
    const c = res.body.completion as AppCompletionResponse;
    expect(c.donePercent).toBe(70);
    expect(c.remainingPercent).toBe(30);
    expect(c.counts.total).toBe(60);
    expect(c.counts.done).toBe(42);
  });
});
