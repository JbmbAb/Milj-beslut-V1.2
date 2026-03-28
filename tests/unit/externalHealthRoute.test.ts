import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createTokenPair } from '../../server/security/auth';
import { createApp } from '../../server/createApp';
import type { ExternalHealthReport } from '../../types';

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

const mockReport: ExternalHealthReport = {
  checkedAt: new Date().toISOString(),
  overall: 'degraded',
  totals: {
    total: 3,
    healthy: 1,
    degraded: 1,
    error: 0,
    notConfigured: 1,
    configured: 2,
    liveChecked: 1,
  },
  categories: [
    { name: 'AI', total: 1, healthy: 1, degraded: 0, error: 0, notConfigured: 0 },
    { name: 'Identitet', total: 1, healthy: 0, degraded: 0, error: 0, notConfigured: 1 },
    { name: 'Workflow', total: 1, healthy: 0, degraded: 1, error: 0, notConfigured: 0 },
  ],
  checks: [
    {
      key: 'gemini',
      label: 'Gemini',
      category: 'AI',
      status: 'healthy',
      mode: 'live',
      configured: true,
      detail: 'OK',
      endpoint: 'https://example.invalid/gemini',
      responseCode: 200,
      activation: 'OPTIONAL',
    },
    {
      key: 'bankid',
      label: 'BankID',
      category: 'Identitet',
      status: 'not_configured',
      mode: 'config',
      configured: false,
      detail: 'Missing config',
      endpoint: null,
      responseCode: null,
      activation: 'PERMIT_REQUIRED',
    },
    {
      key: 'permit_authority',
      label: 'Permit authority',
      category: 'Workflow',
      status: 'degraded',
      mode: 'config',
      configured: true,
      detail: 'Configured only',
      endpoint: 'https://example.invalid/authority',
      responseCode: null,
      activation: 'OPTIONAL',
    },
  ],
};

vi.mock('../../server/repositories/adminReportRepository', () => ({
  getAdminExamSummary: vi.fn(),
  getAdminDatabaseDump: vi.fn(),
  getDbStats: vi.fn(),
  getDbAnalysis: vi.fn(),
  getDbContents: vi.fn(),
  getAppStatus: vi.fn(),
  getAppCompletion: vi.fn(),
  getExternalHealth: vi.fn(async () => mockReport),
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

describe('GET /api/admin/external-health', () => {
  it('returns 401 without auth token', async () => {
    const res = await request(app).get('/api/admin/external-health');
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin users', async () => {
    const res = await request(app)
      .get('/api/admin/external-health')
      .set('Authorization', consultantAuthHeader());
    expect(res.status).toBe(403);
  });

  it('returns mocked report for admin users', async () => {
    const res = await request(app).get('/api/admin/external-health').set('Authorization', adminAuthHeader());

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.report.overall).toBe('degraded');
    expect(res.body.report.totals.total).toBe(3);
    expect(Array.isArray(res.body.report.checks)).toBe(true);
    expect(res.body.report.checks[0].key).toBe('gemini');
  });
});
