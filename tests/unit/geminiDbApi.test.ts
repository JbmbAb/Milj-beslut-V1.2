import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../server/repositories/requirementsRepository', () => ({
  listRequirementCases: vi.fn(),
  listRequirementRows: vi.fn(),
  listRequirementCitations: vi.fn(),
  getRequirementByCode: vi.fn(),
}));

import geminiDbRouter from '../../server/geminiDbApi.express';
import {
  getRequirementByCode,
  listRequirementCases,
  listRequirementCitations,
  listRequirementRows,
} from '../../server/repositories/requirementsRepository';

const originalEnv = { ...process.env };

function createTestApp(trustProxy: boolean = false) {
  const app = express();
  if (trustProxy) {
    app.set('trust proxy', true);
  }
  app.use(geminiDbRouter);
  return app;
}

describe('geminiDbApi.express', () => {
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      GEMINI_DB_API_KEY: 'unit-test-key',
      GEMINI_DB_ALLOW_REMOTE: 'false',
    };

    vi.mocked(listRequirementCases).mockReset();
    vi.mocked(listRequirementRows).mockReset();
    vi.mocked(listRequirementCitations).mockReset();
    vi.mocked(getRequirementByCode).mockReset();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns 503 when GEMINI_DB_API_KEY is missing', async () => {
    delete process.env.GEMINI_DB_API_KEY;
    const app = createTestApp();

    const res = await request(app).get('/api/gemini-db/health');

    expect(res.status).toBe(503);
    expect(res.body?.ok).toBe(false);
    expect(String(res.body?.error || '')).toMatch(/GEMINI_DB_API_KEY/i);
  });

  it('returns 401 when request key is missing or invalid', async () => {
    const app = createTestApp();

    const missingRes = await request(app).get('/api/gemini-db/health');
    expect(missingRes.status).toBe(401);

    const wrongRes = await request(app).get('/api/gemini-db/health').set('x-gemini-db-key', 'wrong-key');
    expect(wrongRes.status).toBe(401);
  });

  it('blocks non-loopback clients unless remote access is enabled', async () => {
    const app = createTestApp(true);

    const res = await request(app)
      .get('/api/gemini-db/health')
      .set('x-gemini-db-key', 'unit-test-key')
      .set('x-forwarded-for', '203.0.113.10');

    expect(res.status).toBe(403);
    expect(String(res.body?.error || '')).toMatch(/restricted to localhost/i);
  });

  it('serves read-only rows endpoint with normalized query filters', async () => {
    vi.mocked(listRequirementRows).mockResolvedValue({
      items: [{ requirementCode: 'REQ-1' }],
      total: 1,
      page: 1,
      pageSize: 200,
    });

    const app = createTestApp();
    const res = await request(app)
      .get(
        '/api/gemini-db/requirements/rows?page=0&pageSize=999&verificationStatus=VERIFIED&includePreliminary=ja&organisationId=test-org-1',
      )
      .set('x-gemini-db-key', 'unit-test-key');

    expect(res.status).toBe(200);
    expect(res.body?.ok).toBe(true);
    expect(res.body?.scope).toBe('ALL');
    expect(Array.isArray(res.body?.items)).toBe(true);
    expect(vi.mocked(listRequirementRows)).toHaveBeenCalledWith({
      page: 1,
      pageSize: 200,
      organisationId: 'test-org-1',
      municipality: undefined,
      documentType: undefined,
      category: undefined,
      caseId: undefined,
      requirementCode: undefined,
      verificationStatus: 'VERIFIED',
      includePreliminary: true,
    });
  });

  it('returns requirement detail by requirementCode', async () => {
    vi.mocked(getRequirementByCode).mockResolvedValue({
      id: 'req-id',
      requirementCode: 'REQ-123',
      citations: [],
    });

    const app = createTestApp();
    const res = await request(app)
      .get('/api/gemini-db/requirements/rows/REQ-123?organisationId=test-org-1')
      .set('x-gemini-db-key', 'unit-test-key');

    expect(res.status).toBe(200);
    expect(res.body?.ok).toBe(true);
    expect(res.body?.row?.requirementCode).toBe('REQ-123');
  });

  it('returns 200 health ok when configured and local', async () => {
    const app = createTestApp();
    const res = await request(app).get('/api/gemini-db/health').set('x-gemini-db-key', 'unit-test-key');

    expect(res.status).toBe(200);
    expect(res.body?.ok).toBe(true);
    expect(Array.isArray(res.body?.endpoints)).toBe(true);
  });

  it('allows remote access when GEMINI_DB_ALLOW_REMOTE=true', async () => {
    process.env.GEMINI_DB_ALLOW_REMOTE = 'true';
    const app = createTestApp(true);

    const res = await request(app)
      .get('/api/gemini-db/health')
      .set('x-gemini-db-key', 'unit-test-key')
      .set('x-forwarded-for', '203.0.113.10');

    expect(res.status).toBe(200);
    expect(res.body?.ok).toBe(true);
  });

  it('GET /requirements/cases returns paginated cases', async () => {
    vi.mocked(listRequirementCases).mockResolvedValue({
      items: [{ id: 'case-1', municipality: 'Stockholm' }],
      total: 1,
      page: 1,
      pageSize: 50,
    });

    const app = createTestApp();
    const res = await request(app)
      .get('/api/gemini-db/requirements/cases?organisationId=test-org-1')
      .set('x-gemini-db-key', 'unit-test-key');

    expect(res.status).toBe(200);
    expect(res.body?.ok).toBe(true);
    expect(res.body?.scope).toBe('READ_ONLY');
    expect(Array.isArray(res.body?.items)).toBe(true);
    expect(vi.mocked(listRequirementCases)).toHaveBeenCalledOnce();
  });

  it('GET /requirements/cases with filters passes them to repository', async () => {
    vi.mocked(listRequirementCases).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 });

    const app = createTestApp();
    await request(app)
      .get(
        '/api/gemini-db/requirements/cases?organisationId=test-org-1&municipality=Göteborg&documentType=PBL&verificationStatus=REVIEWED',
      )
      .set('x-gemini-db-key', 'unit-test-key');

    expect(vi.mocked(listRequirementCases)).toHaveBeenCalledWith(
      expect.objectContaining({
        municipality: 'Göteborg',
        documentType: 'PBL',
        verificationStatus: 'REVIEWED',
      }),
    );
  });

  it('GET /requirements/cases handles repository error', async () => {
    vi.mocked(listRequirementCases).mockRejectedValue(new Error('DB failure'));

    const app = createTestApp();
    const res = await request(app)
      .get('/api/gemini-db/requirements/cases?organisationId=test-org-1')
      .set('x-gemini-db-key', 'unit-test-key');

    expect(res.status).toBe(400);
    expect(res.body?.ok).toBe(false);
    // Error is sanitized by toSafeErrorResponse; just verify it's an error response.
    expect(typeof res.body?.error).toBe('string');
    expect(res.body?.error.length).toBeGreaterThan(0);
  });

  it('GET /requirements/rows with default filters', async () => {
    vi.mocked(listRequirementRows).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 });

    const app = createTestApp();
    const res = await request(app)
      .get('/api/gemini-db/requirements/rows?organisationId=test-org-1')
      .set('x-gemini-db-key', 'unit-test-key');

    expect(res.status).toBe(200);
    expect(res.body?.ok).toBe(true);
    expect(res.body?.scope).toBe('VERIFIED_ONLY');
    expect(res.body?.includePreliminary).toBe(false);
  });

  it('GET /requirements/rows handles repository error', async () => {
    vi.mocked(listRequirementRows).mockRejectedValue(new Error('Row error'));

    const app = createTestApp();
    const res = await request(app)
      .get('/api/gemini-db/requirements/rows?organisationId=test-org-1')
      .set('x-gemini-db-key', 'unit-test-key');

    expect(res.status).toBe(400);
    expect(res.body?.ok).toBe(false);
  });

  it('GET /requirements/rows/:requirementCode returns 404 when not found', async () => {
    vi.mocked(getRequirementByCode).mockResolvedValue(null);

    const app = createTestApp();
    const res = await request(app)
      .get('/api/gemini-db/requirements/rows/NON-EXISTING?organisationId=test-org-1')
      .set('x-gemini-db-key', 'unit-test-key');

    expect(res.status).toBe(404);
    expect(res.body?.ok).toBe(false);
  });

  it('GET /requirements/rows/:requirementCode handles repository error', async () => {
    vi.mocked(getRequirementByCode).mockRejectedValue(new Error('lookup failed'));

    const app = createTestApp();
    const res = await request(app)
      .get('/api/gemini-db/requirements/rows/REQ-ERROR?organisationId=test-org-1')
      .set('x-gemini-db-key', 'unit-test-key');

    expect(res.status).toBe(400);
    expect(res.body?.ok).toBe(false);
  });

  it('GET /requirements/citations returns paginated citations', async () => {
    vi.mocked(listRequirementCitations).mockResolvedValue({
      items: [{ id: 'cit-1', requirementCode: 'REQ-1' }],
      total: 1,
      page: 1,
      pageSize: 50,
    });

    const app = createTestApp();
    const res = await request(app)
      .get('/api/gemini-db/requirements/citations?organisationId=test-org-1')
      .set('x-gemini-db-key', 'unit-test-key');

    expect(res.status).toBe(200);
    expect(res.body?.ok).toBe(true);
    expect(Array.isArray(res.body?.items)).toBe(true);
    expect(res.body?.scope).toBe('VERIFIED_ONLY');
  });

  it('GET /requirements/citations with includePreliminary=true shows ALL scope', async () => {
    vi.mocked(listRequirementCitations).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 });

    const app = createTestApp();
    const res = await request(app)
      .get('/api/gemini-db/requirements/citations?organisationId=test-org-1&includePreliminary=true')
      .set('x-gemini-db-key', 'unit-test-key');

    expect(res.status).toBe(200);
    expect(res.body?.scope).toBe('ALL');
    expect(res.body?.includePreliminary).toBe(true);
  });

  it('GET /requirements/citations handles repository error', async () => {
    vi.mocked(listRequirementCitations).mockRejectedValue(new Error('citations error'));

    const app = createTestApp();
    const res = await request(app)
      .get('/api/gemini-db/requirements/citations?organisationId=test-org-1')
      .set('x-gemini-db-key', 'unit-test-key');

    expect(res.status).toBe(400);
    expect(res.body?.ok).toBe(false);
  });

  it('ignores invalid verificationStatus filter', async () => {
    vi.mocked(listRequirementCases).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 });

    const app = createTestApp();
    await request(app)
      .get('/api/gemini-db/requirements/cases?organisationId=test-org-1&verificationStatus=INVALID_STATUS')
      .set('x-gemini-db-key', 'unit-test-key');

    expect(vi.mocked(listRequirementCases)).toHaveBeenCalledWith(
      expect.objectContaining({ verificationStatus: undefined }),
    );
  });
});
