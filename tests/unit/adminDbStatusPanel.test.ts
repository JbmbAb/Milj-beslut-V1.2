/**
 * adminDbStatusPanel.test.ts
 *
 * Unit-tests för AdminDbStatusPanel routing och navigation.
 * Verifierar att /api/admin/db-stats endpoint nås korrekt och
 * att svaret matchar DbStatsResponse-typen.
 */

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

const mockDbStats: DbStatsResponse = {
  generatedAt: new Date('2026-03-22T06:00:00Z').toISOString(),
  totals: {
    documents: 1234,
    requirementsFromCases: 41500,
    requirementsExtracted: 800,
    requirements: 42300,
    municipalities: 265,
  },
  thresholds: {
    minRequirements: 41_000,
    minMunicipalities: 260,
    minDocuments: 3_000,
    requirementsOk: true,
    municipalitiesOk: true,
    documentsOk: false,
    allOk: false,
  },
  perMunicipality: [
    { municipality: 'Stockholm', documents: 300, requirements: 12000 },
    { municipality: 'Göteborg', documents: 200, requirements: 8000 },
    { municipality: '(okänd)', documents: 734, requirements: 22300 },
  ],
};

vi.mock('../../server/repositories/adminReportRepository', () => ({
  getAdminExamSummary: vi.fn(),
  getAdminDatabaseDump: vi.fn(),
  getDbStats: vi.fn(async () => mockDbStats),
  getDbAnalysis: vi.fn(),
  getDbContents: vi.fn(),
  getAppCompletion: vi.fn(),
  getAppStatus: vi.fn(),
}));

const app = createApp();

function adminToken() {
  return createTokenPair({
    id: 'test-admin-id',
    organisationId: 'test-org-id',
    bankidId: 'admin:admin',
    role: 'ADMIN',
  }).accessToken;
}

function consultantToken() {
  return createTokenPair({
    id: 'test-user-id',
    organisationId: 'test-org-id',
    bankidId: 'bankid:user',
    role: 'CONSULTANT',
  }).accessToken;
}

describe('AdminDbStatusPanel — /api/admin/db-stats endpoint', () => {
  it('returns 401 without auth token', async () => {
    const res = await request(app).get('/api/admin/db-stats');
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin role', async () => {
    const res = await request(app)
      .get('/api/admin/db-stats')
      .set('Authorization', `Bearer ${consultantToken()}`);
    expect(res.status).toBe(403);
  });

  it('returns 200 with ok:true for admin role', async () => {
    const res = await request(app)
      .get('/api/admin/db-stats')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('returns DbStatsResponse with totals.documents', async () => {
    const res = await request(app)
      .get('/api/admin/db-stats')
      .set('Authorization', `Bearer ${adminToken()}`);
    const stats: DbStatsResponse = res.body.stats;
    expect(stats.totals.documents).toBe(1234);
  });

  it('returns DbStatsResponse with totals.requirements (kravrader)', async () => {
    const res = await request(app)
      .get('/api/admin/db-stats')
      .set('Authorization', `Bearer ${adminToken()}`);
    const stats: DbStatsResponse = res.body.stats;
    expect(stats.totals.requirements).toBe(42300);
    expect(stats.totals.requirementsFromCases).toBe(41500);
    expect(stats.totals.requirementsExtracted).toBe(800);
  });

  it('returns DbStatsResponse with totals.municipalities', async () => {
    const res = await request(app)
      .get('/api/admin/db-stats')
      .set('Authorization', `Bearer ${adminToken()}`);
    const stats: DbStatsResponse = res.body.stats;
    expect(stats.totals.municipalities).toBe(265);
  });

  it('returns thresholds.allOk=false when documents below threshold', async () => {
    const res = await request(app)
      .get('/api/admin/db-stats')
      .set('Authorization', `Bearer ${adminToken()}`);
    const stats: DbStatsResponse = res.body.stats;
    expect(stats.thresholds.documentsOk).toBe(false);
    expect(stats.thresholds.requirementsOk).toBe(true);
    expect(stats.thresholds.municipalitiesOk).toBe(true);
    expect(stats.thresholds.allOk).toBe(false);
  });

  it('returns per-municipality breakdown with Stockholm and Göteborg', async () => {
    const res = await request(app)
      .get('/api/admin/db-stats')
      .set('Authorization', `Bearer ${adminToken()}`);
    const stats: DbStatsResponse = res.body.stats;
    const names = stats.perMunicipality.map((r) => r.municipality);
    expect(names).toContain('Stockholm');
    expect(names).toContain('Göteborg');
    const stockholm = stats.perMunicipality.find((r) => r.municipality === 'Stockholm');
    expect(stockholm?.documents).toBe(300);
    expect(stockholm?.requirements).toBe(12000);
  });

  it('returns generatedAt as ISO string', async () => {
    const res = await request(app)
      .get('/api/admin/db-stats')
      .set('Authorization', `Bearer ${adminToken()}`);
    const stats: DbStatsResponse = res.body.stats;
    expect(() => new Date(stats.generatedAt)).not.toThrow();
    expect(new Date(stats.generatedAt).getFullYear()).toBeGreaterThanOrEqual(2026);
  });
});
