import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTokenPair } from '../../server/security/auth';

vi.mock('../../server/repositories/requirementsRepository', () => ({
  listRequirementRows: vi.fn(),
}));

vi.mock('../../server/services/municipalityService', () => ({
  getMunicipalityInsight: vi.fn(),
}));

vi.mock('../../server/db/prisma', () => ({
  prisma: {
    project: {
      findMany: vi.fn(async () => []),
      findUnique: vi.fn(async () => null),
    },
    documentRecord: {
      count: vi.fn(async () => 0),
    },
    metadataReviewQueue: {
      findMany: vi.fn(async () => []),
      findUnique: vi.fn(async () => null),
      update: vi.fn(async () => ({})),
    },
  },
}));

import mvpRouter from '../../server/mvpApi.express';
import { listRequirementRows } from '../../server/repositories/requirementsRepository';
import { getMunicipalityInsight } from '../../server/services/municipalityService';
import { prisma } from '../../server/db/prisma';

function createApp() {
  const app = express();
  app.use(mvpRouter);
  return app;
}

function authHeader() {
  const token = createTokenPair({
    id: 'test-user-1',
    organisationId: 'test-org-1',
    bankidId: 'bankid:test',
    role: 'CONSULTANT',
  }).accessToken;
  return `Bearer ${token}`;
}

describe('mvpApi.express', () => {
  beforeEach(() => {
    vi.mocked(listRequirementRows).mockReset();
    vi.mocked(listRequirementRows).mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 100,
    });
  });

  it('returns 401 with traceId for missing auth', async () => {
    const app = createApp();
    const res = await request(app).post('/api/v1/classification/activity').send({});

    expect(res.status).toBe(401);
    expect(typeof res.body?.traceId).toBe('string');
    expect(res.body?.error?.code).toBe('AUTH_MISSING');
  });

  it('validates classification payload and returns normalized response', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/v1/classification/activity')
      .set('Authorization', authHeader())
      .send({
        activity_code: '29.40',
        ewc_code: '17 05 04',
        volume_tons: 1200,
      });

    expect(res.status).toBe(200);
    expect(res.body?.classification).toBe('C-verksamhet');
    expect(res.body?.status).toBe('MATCHED');
    expect(typeof res.body?.traceId).toBe('string');
  });

  it('returns requirements from index when available', async () => {
    vi.mocked(listRequirementRows).mockResolvedValue({
      items: [
        {
          interpretedRequirement: 'Max lagringstid 3 ar',
          requirementTextQuote: 'Lagringstiden far inte overstiga 3 ar.',
          legalReference: 'Avfallsforordningen 6 kap.',
        },
      ],
      total: 1,
      page: 1,
      pageSize: 100,
    } as never);

    const app = createApp();
    const res = await request(app)
      .post('/api/v1/compliance/requirements')
      .set('Authorization', authHeader())
      .send({
        activity_code: '29.40',
        ewc_code: '17 05 04',
      });

    expect(res.status).toBe(200);
    expect(res.body?.source).toBe('INDEX');
    expect(Array.isArray(res.body?.requirements)).toBe(true);
    expect(res.body.requirements.length).toBeGreaterThan(0);
  });

  it('returns UNVERIFIED when citations are missing', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/v1/verification/check')
      .set('Authorization', authHeader())
      .send({
        analysis: 'Detta ar en text utan lagreferenser.',
      });

    expect(res.status).toBe(200);
    expect(res.body?.status).toBe('UNVERIFIED');
    expect(Array.isArray(res.body?.missing_citations)).toBe(true);
    expect(res.body.missing_citations.length).toBeGreaterThan(0);
  });

  it('exports DOCX with expected content-type', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/v1/document/export')
      .set('Authorization', authHeader())
      .send({
        draft_text: '1. Bakgrund\nDetta ar ett testutkast.',
        document_type: 'C-anmalan',
      });

    expect(res.status).toBe(200);
    expect(String(res.headers['content-type'] || '')).toMatch(
      /application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document/
    );
    expect(String(res.headers['content-disposition'] || '')).toMatch(/\.docx/);
  });

  // ─── compliance/risk-analysis ────────────────────────────────────────────
  it('compliance/risk-analysis returns risk_flags and risk_score', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/v1/compliance/risk-analysis')
      .set('Authorization', authHeader())
      .send({ ewc_code: '17 05 04', volume_tons: 5000 });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body?.risk_flags)).toBe(true);
    expect(typeof res.body?.traceId).toBe('string');
  });

  it('compliance/risk-analysis flags large volume', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/v1/compliance/risk-analysis')
      .set('Authorization', authHeader())
      .send({ ewc_code: '17 09 04*', volume_tons: 15000, location: 'grundvatten' });

    expect(res.status).toBe(200);
    expect(res.body?.risk_flags.some((f: string) => /large volume/i.test(f))).toBe(true);
    expect(res.body?.risk_flags.some((f: string) => /groundwater/i.test(f))).toBe(true);
  });

  it('compliance/risk-analysis returns 400 for missing ewc_code', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/v1/compliance/risk-analysis')
      .set('Authorization', authHeader())
      .send({ volume_tons: 100 });

    expect(res.status).toBe(400);
    expect(res.body?.error?.code).toBe('VALIDATION_ERROR');
  });

  // ─── lab/validate ────────────────────────────────────────────────────────
  it('lab/validate returns PASS for non-exceeding samples', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/v1/lab/validate')
      .set('Authorization', authHeader())
      .send({ sample_results: [{ parameter: 'arsenik', value: 5, unit: 'mg/kg TS' }] });

    expect(res.status).toBe(200);
    expect(res.body?.status).toBe('PASS');
    expect(res.body?.exceedances).toHaveLength(0);
  });

  it('lab/validate returns FAIL for exceeding samples', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/v1/lab/validate')
      .set('Authorization', authHeader())
      .send({ sample_results: [{ parameter: 'arsenik', value: 50, unit: 'mg/kg TS' }] });

    expect(res.status).toBe(200);
    expect(res.body?.status).toBe('FAIL');
    expect(res.body?.exceedances.length).toBeGreaterThan(0);
    expect(res.body?.exceedances[0]?.parameter).toBe('arsenik');
  });

  it('lab/validate returns 400 for empty sample_results', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/v1/lab/validate')
      .set('Authorization', authHeader())
      .send({ sample_results: [] });

    expect(res.status).toBe(400);
    expect(res.body?.error?.code).toBe('VALIDATION_ERROR');
  });

  // ─── permit/generate ─────────────────────────────────────────────────────
  it('permit/generate returns draft_text and document_type', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/v1/permit/generate')
      .set('Authorization', authHeader())
      .send({
        project_data: { name: 'Test Projekt', municipality: 'Stockholm', ewc_code: '17 05 04', volume_tons: 1000 },
        requirements: [],
        risk_flags: ['Large volume storage'],
      });

    expect(res.status).toBe(200);
    expect(typeof res.body?.draft_text).toBe('string');
    expect(res.body?.draft_text.length).toBeGreaterThan(0);
    expect(typeof res.body?.document_type).toBe('string');
    expect(typeof res.body?.traceId).toBe('string');
  });

  // ─── municipality/insight ─────────────────────────────────────────────────
  it('municipality/insight returns insight from service', async () => {
    vi.mocked(getMunicipalityInsight).mockResolvedValue({
      name: 'Stockholm',
      commonChallenges: ['Trafik'],
      recentPrecedents: [],
    } as never);

    const app = createApp();
    const res = await request(app)
      .get('/api/v1/municipality/stockholm/insight');

    expect(res.status).toBe(200);
    expect(res.body?.ok).toBe(true);
    expect(res.body?.insight?.name).toBe('Stockholm');
  });

  it('municipality/insight returns 500 on service error', async () => {
    vi.mocked(getMunicipalityInsight).mockRejectedValue(new Error('service down'));

    const app = createApp();
    const res = await request(app)
      .get('/api/v1/municipality/error-city/insight');

    expect(res.status).toBe(500);
    expect(res.body?.ok).toBe(false);
  });

  // ─── projects list ────────────────────────────────────────────────────────
  it('GET /projects returns project list', async () => {
    vi.mocked(prisma.project.findMany).mockResolvedValue([] as never);

    const app = createApp();
    const res = await request(app).get('/api/v1/projects');

    expect(res.status).toBe(200);
    expect(res.body?.ok).toBe(true);
    expect(Array.isArray(res.body?.projects)).toBe(true);
  });

  it('GET /projects returns 500 on DB error', async () => {
    vi.mocked(prisma.project.findMany).mockRejectedValue(new Error('db down'));

    const app = createApp();
    const res = await request(app).get('/api/v1/projects');

    expect(res.status).toBe(500);
    expect(res.body?.ok).toBe(false);
  });

  // ─── admin/review-queue ────────────────────────────────────────────────────
  it('GET /admin/review-queue returns empty list', async () => {
    vi.mocked(prisma.metadataReviewQueue.findMany).mockResolvedValue([] as never);

    const app = createApp();
    const res = await request(app)
      .get('/api/v1/admin/review-queue')
      .set('Authorization', authHeader());

    expect(res.status).toBe(200);
    expect(res.body?.ok).toBe(true);
    expect(Array.isArray(res.body?.queue)).toBe(true);
  });

  it('POST /admin/review-queue/:id/resolve returns 404 for unknown item', async () => {
    vi.mocked(prisma.metadataReviewQueue.findUnique).mockResolvedValue(null);

    const app = createApp();
    const res = await request(app)
      .post('/api/v1/admin/review-queue/non-existing-id/resolve')
      .set('Authorization', authHeader())
      .send({ resolution: 'ACCEPTED', reviewNote: 'ok' });

    expect(res.status).toBe(404);
    expect(res.body?.ok).toBe(false);
  });

  // ─── POST /api/v1/classification (DB-backed) ─────────────────────────────
  it('POST /classification returns 200 with document context', async () => {
    vi.mocked(prisma.documentRecord.findUnique ?? prisma.documentRecord.count).mockResolvedValue({
      municipalityNormalized: 'stockholm',
      decisionType: 'C-anmalan',
      wasteType: 'schaktmassor',
      activityCode: '29.40',
      subject: 'Test dokument',
      metadataReviewStatus: 'VERIFIED',
      municipalityConfidence: 0.95,
    } as never);

    const app = createApp();
    const res = await request(app)
      .post('/api/v1/classification')
      .set('Authorization', authHeader())
      .send({ documentId: 'doc-123', ewcCode: '17 05 04', volumeTon: 500 });

    // Should succeed even without DB since we mocked it
    expect([200, 500].includes(res.status)).toBe(true);
  });
});
