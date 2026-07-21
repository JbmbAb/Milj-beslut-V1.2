import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTokenPair } from '../../server/security/auth';

const mocks = vi.hoisted(() => ({
  listRequirementRows: vi.fn(),
  runSearchQuery: vi.fn(),
  verifyAnalysis: vi.fn(),
  assertProjectMembership: vi.fn(),
  projectMemberFindMany: vi.fn(),
  documentRecordFindUnique: vi.fn(),
  documentRecordFindMany: vi.fn(),
  queryRawUnsafe: vi.fn(),
}));

vi.mock('../../server/repositories/tokenRepository', () => ({
  isTokenRevoked: vi.fn(async () => false),
  markRefreshTokenAsUsed: vi.fn(async () => undefined),
  revokeRefreshToken: vi.fn(async () => undefined),
  cleanupExpiredTokenRevocations: vi.fn(async () => 0),
}));

vi.mock('../../server/repositories/requirementsRepository', () => ({
  listRequirementRows: mocks.listRequirementRows,
}));

vi.mock('../../server/services/searchService', () => ({
  runSearchQuery: mocks.runSearchQuery,
}));

vi.mock('../../server/services/coreContractService', async () => {
  const actual = await vi.importActual<typeof import('../../server/services/coreContractService')>(
    '../../server/services/coreContractService',
  );
  return {
    ...actual,
    verifyAnalysis: mocks.verifyAnalysis,
  };
});

vi.mock('../../server/repositories/projectAccessRepository', () => ({
  assertProjectMembership: mocks.assertProjectMembership,
}));

// Mock rate limiting to avoid prisma.$transaction issues in unit tests.
vi.mock('../../server/security/rateLimit', () => ({
  rateLimitByUser: vi.fn(() => (_req: any, _res: any, next: any) => next()),
}));

vi.mock('../../server/db/prisma', () => ({
  prisma: {
    projectMember: {
      findMany: mocks.projectMemberFindMany,
    },
    documentRecord: {
      findUnique: mocks.documentRecordFindUnique,
      findMany: mocks.documentRecordFindMany,
    },
    $queryRawUnsafe: mocks.queryRawUnsafe,
    metadataReviewQueue: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

import coreRouter from '../../server/coreApi.express';
import { listRequirementRows } from '../../server/repositories/requirementsRepository';
import { runSearchQuery } from '../../server/services/searchService';
import { assertProjectMembership } from '../../server/repositories/projectAccessRepository';

function createApp() {
  const app = express();
  app.use(coreRouter);
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

describe('coreApi.express', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyAnalysis.mockResolvedValue({
      status: 'UNVERIFIED',
      missing_citations: ['MB 2 kap.'],
      traceId: 'trace-test',
    });
    vi.mocked(listRequirementRows).mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 100,
    });
    vi.mocked(runSearchQuery).mockResolvedValue({
      results: [],
      resultCount: 0,
      elapsedMs: 1,
      filtersApplied: {},
      scope: 'project',
      strictEvidence: false,
      citationCoveragePct: 0,
      evidenceFilteredOut: 0,
    } as never);
    vi.mocked(assertProjectMembership).mockResolvedValue(undefined);
    mocks.projectMemberFindMany.mockResolvedValue([]);
    mocks.documentRecordFindUnique.mockResolvedValue(null);
    mocks.documentRecordFindMany.mockResolvedValue([]);
    mocks.queryRawUnsafe.mockResolvedValue([]);
  });

  it('returns 401 with traceId for missing auth', async () => {
    const app = createApp();
    const res = await request(app).post('/api/v1/classification/activity').send({});

    expect(res.status).toBe(401);
    expect(typeof res.body?.traceId).toBe('string');
    expect(res.body?.error?.code).toBe('AUTH_MISSING');
  });

  it('lists Core projects for the authenticated member with coverage percentages', async () => {
    mocks.projectMemberFindMany.mockResolvedValue([
      {
        project: {
          id: 'project-1',
          propertyDesignation: 'Orsa 1:1',
          status: 'ACTIVE',
          documents: [
            { municipalityNormalized: 'Orsa', decisionType: 'Tillstand' },
            { municipalityNormalized: 'Orsa', decisionType: null },
          ],
        },
      },
    ]);

    const app = createApp();
    const res = await request(app).get('/api/v1/projects').set('Authorization', authHeader());

    expect(res.status).toBe(200);
    expect(res.body?.projects).toEqual([
      {
        id: 'project-1',
        propertyDesignation: 'Orsa 1:1',
        status: 'ACTIVE',
        docCount: 2,
        coverage: {
          municipality: 100,
          decisionType: 50,
        },
      },
    ]);
  });

  it('searches inside an Core project after membership verification', async () => {
    vi.mocked(runSearchQuery).mockResolvedValue({
      results: [
        {
          documentId: 'doc-1',
          score: 0.91,
          snippet: 'Lakvatten och tattskikt behover kontroll.',
          whyMatched: 'Hybrid semantic+lexical ranking',
          citations: [],
          metadata: {
            projectId: 'project-1',
            projectName: 'Orsa 1:1',
            organisationName: 'Test Org',
            subject: 'Miljöbeslut',
            originalName: 'orsa-beslut.pdf',
            receivedTime: null,
            municipality: 'Orsa',
            decisionType: 'Tillstand',
            wasteType: null,
            hazardousFlag: null,
            legalStatus: null,
            status: 'EMBEDDED',
          },
        },
      ],
    } as never);

    const app = createApp();
    const res = await request(app)
      .get('/api/v1/projects/project-1/search?q=lakvatten&topK=6')
      .set('Authorization', authHeader());

    expect(res.status).toBe(200);
    expect(assertProjectMembership).toHaveBeenCalledWith({
      projectId: 'project-1',
      userId: 'test-user-1',
      organisationId: 'test-org-1',
      role: 'CONSULTANT',
    });
    expect(runSearchQuery).toHaveBeenCalledWith({
      projectId: 'project-1',
      organisationId: 'test-org-1',
      userId: 'test-user-1',
      query: 'lakvatten',
      mode: 'hybrid',
      topK: 6,
      strictEvidence: false,
    });
    expect(res.body?.results?.[0]).toEqual({
      id: 'doc-1',
      originalName: 'orsa-beslut.pdf',
      subject: 'Miljöbeslut',
      municipality: 'Orsa',
      decisionType: 'Tillstand',
      snippet: 'Lakvatten och tattskikt behover kontroll.',
      score: 0.91,
    });
  });

  it('returns 403 for Core project search when membership verification fails', async () => {
    vi.mocked(assertProjectMembership).mockRejectedValue(new Error('User is not a member of this project'));

    const app = createApp();
    const res = await request(app)
      .get('/api/v1/projects/project-1/search?q=lakvatten')
      .set('Authorization', authHeader());

    expect(res.status).toBe(403);
    expect(res.body?.error?.code).toBe('PROJECT_ACCESS_DENIED');
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
    const res = await request(app).post('/api/v1/document/export').set('Authorization', authHeader()).send({
      draft_text: '1. Bakgrund\nDetta ar ett testutkast.',
      document_type: 'C-anmalan',
    });

    expect(res.status).toBe(200);
    expect(String(res.headers['content-type'] || '')).toMatch(
      /application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document/,
    );
    expect(String(res.headers['content-disposition'] || '')).toMatch(/\.docx/);
  });
});
