import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createTokenPair } from '../../server/security/auth';
import { createApp } from '../../server/createApp';
import type { DbStatsResponse } from '../../types';

vi.mock('../../server/repositories/userRepository', () => ({
  ensureAdminConsoleUser: vi.fn(async () => ({
    id: 'test-admin-id',
    bankidId: 'admin:admin',
    role: 'ADMIN',
    organisationId: 'test-org-id',
  })),
  findAuthUserByBankId: vi.fn(async () => null),
}));

const mockStats: DbStatsResponse = {
  generatedAt: new Date().toISOString(),
  totals: {
    documents: 42,
    requirementsFromCases: 100,
    requirementsExtracted: 30,
    requirements: 130,
    municipalities: 5,
  },
  thresholds: {
    minRequirements: 41_000,
    minMunicipalities: 260,
    minDocuments: 3_000,
    requirementsOk: false,
    municipalitiesOk: false,
    documentsOk: false,
    allOk: false,
  },
  perMunicipality: [
    { municipality: 'Orsa', documents: 10, requirements: 40 },
    { municipality: 'Falun', documents: 8, requirements: 30 },
    { municipality: '(okänd)', documents: 24, requirements: 60 },
  ],
};

vi.mock('../../server/repositories/adminReportRepository', () => ({
  getAdminExamSummary: vi.fn(),
  getAdminDatabaseDump: vi.fn(),
  getExternalHealth: vi.fn(),
  getDbStats: vi.fn(async () => mockStats),
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

describe('GET /api/admin/db-stats', () => {
  it('returns 401 without auth token', async () => {
    const res = await request(app).get('/api/admin/db-stats');
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin users', async () => {
    const res = await request(app)
      .get('/api/admin/db-stats')
      .set('Authorization', consultantAuthHeader());
    expect(res.status).toBe(403);
  });

  it('returns stats for admin users with correct shape', async () => {
    const res = await request(app)
      .get('/api/admin/db-stats')
      .set('Authorization', adminAuthHeader());

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.stats).toBeDefined();
    expect(res.body.stats.totals).toBeDefined();
    expect(typeof res.body.stats.totals.documents).toBe('number');
    expect(typeof res.body.stats.totals.requirements).toBe('number');
    expect(typeof res.body.stats.totals.municipalities).toBe('number');
    expect(Array.isArray(res.body.stats.perMunicipality)).toBe(true);
  });

  it('returns correct totals from the repository', async () => {
    const res = await request(app)
      .get('/api/admin/db-stats')
      .set('Authorization', adminAuthHeader());

    expect(res.body.stats.totals.documents).toBe(42);
    expect(res.body.stats.totals.requirements).toBe(130);
    expect(res.body.stats.totals.requirementsFromCases).toBe(100);
    expect(res.body.stats.totals.requirementsExtracted).toBe(30);
    expect(res.body.stats.totals.municipalities).toBe(5);
  });

  it('returns threshold fields', async () => {
    const res = await request(app)
      .get('/api/admin/db-stats')
      .set('Authorization', adminAuthHeader());

    const { thresholds } = res.body.stats;
    expect(thresholds).toBeDefined();
    expect(thresholds.minRequirements).toBe(41_000);
    expect(thresholds.minMunicipalities).toBe(260);
    expect(thresholds.minDocuments).toBe(3_000);
    expect(typeof thresholds.requirementsOk).toBe('boolean');
    expect(typeof thresholds.municipalitiesOk).toBe('boolean');
    expect(typeof thresholds.documentsOk).toBe('boolean');
    expect(typeof thresholds.allOk).toBe('boolean');
  });

  it('allOk is false when counts are below thresholds', async () => {
    const res = await request(app)
      .get('/api/admin/db-stats')
      .set('Authorization', adminAuthHeader());

    // mock data has 42 docs, 130 requirements, 5 municipalities – all below thresholds
    expect(res.body.stats.thresholds.requirementsOk).toBe(false);
    expect(res.body.stats.thresholds.municipalitiesOk).toBe(false);
    expect(res.body.stats.thresholds.documentsOk).toBe(false);
    expect(res.body.stats.thresholds.allOk).toBe(false);
  });

  it('returns per-municipality breakdown', async () => {
    const res = await request(app)
      .get('/api/admin/db-stats')
      .set('Authorization', adminAuthHeader());

    const municipalities: string[] = res.body.stats.perMunicipality.map(
      (r: { municipality: string }) => r.municipality
    );
    expect(municipalities).toContain('Orsa');
    expect(municipalities).toContain('Falun');

    const orsa = res.body.stats.perMunicipality.find(
      (r: { municipality: string }) => r.municipality === 'Orsa'
    );
    expect(orsa.documents).toBe(10);
    expect(orsa.requirements).toBe(40);
  });
});
