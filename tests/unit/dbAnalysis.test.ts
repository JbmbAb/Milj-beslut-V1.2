import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createTokenPair } from '../../server/security/auth';
import { createApp } from '../../server/createApp';
import type { DbAnalysisResponse } from '../../types';

vi.mock('../../server/repositories/userRepository', () => ({
  ensureAdminConsoleUser: vi.fn(async () => ({
    id: 'test-admin-id',
    bankidId: 'admin:admin',
    role: 'ADMIN',
    organisationId: 'test-org-id',
  })),
  findAuthUserByBankId: vi.fn(async () => null),
}));

const mockAnalysis: DbAnalysisResponse = {
  generatedAt: new Date().toISOString(),
  requirements: {
    byCategory: [
      { category: 'Avfall', count: 120 },
      { category: 'Buller', count: 45 },
    ],
    byCodingConfidence: [
      { confidence: 'HIGH', count: 80 },
      { confidence: 'MEDIUM', count: 50 },
      { confidence: 'LOW', count: 35 },
    ],
    byLevel: [
      { level: 'mandatory', count: 150 },
      { level: 'recommended', count: 15 },
    ],
    byStatus: [
      { status: 'Ej behandlad', count: 130 },
      { status: 'Uppfylld', count: 35 },
    ],
    municipalitySpecificCount: 12,
    minimumRequirementCount: 30,
    withCitationsCount: 100,
    citationsTotal: 220,
  },
  documents: {
    byStatus: [
      { status: 'COMPLETE', count: 35 },
      { status: 'METADATA_ONLY', count: 7 },
    ],
    byDecisionType: [
      { decisionType: 'Tillstånd', count: 28 },
      { decisionType: '(okänd)', count: 14 },
    ],
    byLegalStatus: [
      { legalStatus: 'Lagakraftvunnen', count: 25 },
      { legalStatus: '(okänd)', count: 17 },
    ],
    municipalityConfidenceBuckets: {
      high: 28,
      medium: 8,
      low: 4,
      missing: 2,
    },
  },
  coverage: {
    documentsWithRequirements: 35,
    documentsWithoutRequirements: 7,
    coverageRatioPct: 83.3,
    avgRequirementsPerCoveredDocument: 4.7,
    municipalitiesWithBoth: 3,
    municipalitiesDocumentsOnly: ['Falun'],
    municipalitiesRequirementsOnly: [],
  },
  extractedRequirements: {
    byCategory: [
      { category: 'Vatten', count: 15 },
      { category: 'Luft', count: 9 },
    ],
    byLevel: [
      { level: 'mandatory', count: 20 },
      { level: 'recommended', count: 4 },
    ],
    confidenceBuckets: { high: 14, medium: 8, low: 2 },
  },
};

vi.mock('../../server/repositories/adminReportRepository', () => ({
  getAdminExamSummary: vi.fn(),
  getAdminDatabaseDump: vi.fn(),
  getDbStats: vi.fn(),
  getDbAnalysis: vi.fn(async () => mockAnalysis),
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

describe('GET /api/admin/db-analysis', () => {
  it('returns 401 without auth token', async () => {
    const res = await request(app).get('/api/admin/db-analysis');
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin users', async () => {
    const res = await request(app)
      .get('/api/admin/db-analysis')
      .set('Authorization', consultantAuthHeader());
    expect(res.status).toBe(403);
  });

  it('returns 200 with correct top-level shape for admin', async () => {
    const res = await request(app)
      .get('/api/admin/db-analysis')
      .set('Authorization', adminAuthHeader());

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const a = res.body.analysis;
    expect(a).toBeDefined();
    expect(typeof a.generatedAt).toBe('string');
    expect(a.requirements).toBeDefined();
    expect(a.documents).toBeDefined();
    expect(a.coverage).toBeDefined();
    expect(a.extractedRequirements).toBeDefined();
  });

  it('returns requirements breakdown', async () => {
    const res = await request(app)
      .get('/api/admin/db-analysis')
      .set('Authorization', adminAuthHeader());

    const { requirements } = res.body.analysis;
    expect(Array.isArray(requirements.byCategory)).toBe(true);
    expect(requirements.byCategory[0].category).toBe('Avfall');
    expect(requirements.byCategory[0].count).toBe(120);

    expect(Array.isArray(requirements.byCodingConfidence)).toBe(true);
    const high = requirements.byCodingConfidence.find((r: { confidence: string }) => r.confidence === 'HIGH');
    expect(high.count).toBe(80);

    expect(typeof requirements.withCitationsCount).toBe('number');
    expect(typeof requirements.citationsTotal).toBe('number');
    expect(typeof requirements.municipalitySpecificCount).toBe('number');
    expect(typeof requirements.minimumRequirementCount).toBe('number');
  });

  it('returns document confidence buckets', async () => {
    const res = await request(app)
      .get('/api/admin/db-analysis')
      .set('Authorization', adminAuthHeader());

    const { municipalityConfidenceBuckets } = res.body.analysis.documents;
    expect(municipalityConfidenceBuckets.high).toBe(28);
    expect(municipalityConfidenceBuckets.medium).toBe(8);
    expect(municipalityConfidenceBuckets.low).toBe(4);
    expect(municipalityConfidenceBuckets.missing).toBe(2);
  });

  it('returns coverage analysis', async () => {
    const res = await request(app)
      .get('/api/admin/db-analysis')
      .set('Authorization', adminAuthHeader());

    const { coverage } = res.body.analysis;
    expect(coverage.documentsWithRequirements).toBe(35);
    expect(coverage.documentsWithoutRequirements).toBe(7);
    expect(coverage.coverageRatioPct).toBe(83.3);
    expect(typeof coverage.avgRequirementsPerCoveredDocument).toBe('number');
    expect(Array.isArray(coverage.municipalitiesDocumentsOnly)).toBe(true);
    expect(coverage.municipalitiesDocumentsOnly).toContain('Falun');
    expect(Array.isArray(coverage.municipalitiesRequirementsOnly)).toBe(true);
  });

  it('returns extracted requirements analysis', async () => {
    const res = await request(app)
      .get('/api/admin/db-analysis')
      .set('Authorization', adminAuthHeader());

    const { extractedRequirements } = res.body.analysis;
    expect(Array.isArray(extractedRequirements.byCategory)).toBe(true);
    expect(extractedRequirements.confidenceBuckets.high).toBe(14);
    expect(extractedRequirements.confidenceBuckets.medium).toBe(8);
    expect(extractedRequirements.confidenceBuckets.low).toBe(2);
  });
});
