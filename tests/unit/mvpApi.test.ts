import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTokenPair } from '../../server/security/auth';

vi.mock('../../server/repositories/requirementsRepository', () => ({
  listRequirementRows: vi.fn(),
}));

import mvpRouter from '../../server/mvpApi.express';
import { listRequirementRows } from '../../server/repositories/requirementsRepository';

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
});
