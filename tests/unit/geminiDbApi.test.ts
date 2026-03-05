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

    const wrongRes = await request(app)
      .get('/api/gemini-db/health')
      .set('x-gemini-db-key', 'wrong-key');
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
      .get('/api/gemini-db/requirements/rows?page=0&pageSize=999&verificationStatus=VERIFIED&includePreliminary=ja')
      .set('x-gemini-db-key', 'unit-test-key');

    expect(res.status).toBe(200);
    expect(res.body?.ok).toBe(true);
    expect(res.body?.scope).toBe('ALL');
    expect(Array.isArray(res.body?.items)).toBe(true);
    expect(vi.mocked(listRequirementRows)).toHaveBeenCalledWith({
      page: 1,
      pageSize: 200,
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
      .get('/api/gemini-db/requirements/rows/REQ-123')
      .set('x-gemini-db-key', 'unit-test-key');

    expect(res.status).toBe(200);
    expect(res.body?.ok).toBe(true);
    expect(res.body?.row?.requirementCode).toBe('REQ-123');
  });
});
