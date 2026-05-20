import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTokenPair } from '../../server/security/auth';

const mocks = vi.hoisted(() => ({
  getSearchConfig: vi.fn(),
  runSearchQuery: vi.fn(),
  enqueueSearchJob: vi.fn(),
  getSearchStatus: vi.fn(),
  recoverStaleRunningJobs: vi.fn(),
  requeueFailedJobs: vi.fn(),
  processSearchJobsOnce: vi.fn(),
  assertProjectMembership: vi.fn(),
}));

vi.mock('../../server/repositories/tokenRepository', () => ({
  isTokenRevoked: vi.fn(async () => false),
  markRefreshTokenAsUsed: vi.fn(async () => undefined),
  revokeRefreshToken: vi.fn(async () => undefined),
  cleanupExpiredTokenRevocations: vi.fn(async () => 0),
}));

vi.mock('../../server/modules/search/public', () => ({
  getSearchConfig: mocks.getSearchConfig,
  runSearchQuery: mocks.runSearchQuery,
  enqueueSearchJob: mocks.enqueueSearchJob,
  getSearchStatus: mocks.getSearchStatus,
  recoverStaleRunningJobs: mocks.recoverStaleRunningJobs,
  requeueFailedJobs: mocks.requeueFailedJobs,
  processSearchJobsOnce: mocks.processSearchJobsOnce,
  getDocumentById: vi.fn(),
  deleteDocumentById: vi.fn(),
  listProjectsForAdmin: vi.fn(),
  createOrGetAdminProject: vi.fn(),
}));

vi.mock('../../server/modules/project/public', () => ({
  assertProjectMembership: mocks.assertProjectMembership,
}));

import searchRoutes from '../../server/routes/search.routes';

const app = express();
app.use(express.json());
app.use(searchRoutes);

function authHeader(role: 'ADMIN' | 'CONSULTANT' = 'ADMIN') {
  return `Bearer ${
    createTokenPair({
      id: role === 'ADMIN' ? 'admin-1' : 'user-1',
      organisationId: 'org-1',
      bankidId: role === 'ADMIN' ? 'admin:one' : 'consultant:one',
      role,
    }).accessToken
  }`;
}

describe('search.routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSearchConfig.mockReturnValue({
      manifestPath: '/data/manifest.json',
      outlookBaseDir: '/data/outlook',
    });
    mocks.enqueueSearchJob.mockResolvedValue({ id: 'job-1' });
    mocks.processSearchJobsOnce.mockResolvedValue(1);
    mocks.assertProjectMembership.mockResolvedValue(undefined);
    mocks.runSearchQuery.mockResolvedValue({ hits: [{ id: 'doc-1' }] });
    mocks.getSearchStatus.mockResolvedValue({ queued: 1, failed: 0 });
    mocks.recoverStaleRunningJobs.mockResolvedValue(3);
    mocks.requeueFailedJobs.mockResolvedValue(4);
  });

  it('validates sync-manifest and enqueues jobs with config defaults', async () => {
    const missing = await request(app)
      .post('/api/search/sync-manifest')
      .set('Authorization', authHeader('ADMIN'))
      .send({});

    expect(missing.status).toBe(400);

    const res = await request(app)
      .post('/api/search/sync-manifest')
      .set('Authorization', authHeader('ADMIN'))
      .send({ projectId: 'project-1' });

    expect(res.status).toBe(200);
    expect(mocks.assertProjectMembership).toHaveBeenCalledWith({
      projectId: 'project-1',
      userId: 'admin-1',
      organisationId: 'org-1',
      role: 'ADMIN',
    });
    expect(mocks.enqueueSearchJob).toHaveBeenCalledWith({
      type: 'SYNC_MANIFEST',
      projectId: 'project-1',
      payload: {
        projectId: 'project-1',
        organisationId: 'org-1',
        manifestPath: '/data/manifest.json',
        outlookBaseDir: '/data/outlook',
      },
    });
    expect(mocks.processSearchJobsOnce).toHaveBeenCalledWith(1);
  });

  it('requires project membership for query and normalizes filters', async () => {
    const missingProject = await request(app)
      .post('/api/search/query')
      .set('Authorization', authHeader('CONSULTANT'))
      .send({ query: 'vatten' });

    expect(missingProject.status).toBe(400);

    const res = await request(app)
      .post('/api/search/query')
      .set('Authorization', authHeader('CONSULTANT'))
      .send({
        projectId: 'project-1',
        query: 'vatten',
        mode: 'lexical',
        topK: 5,
        strictEvidence: 'no',
        filters: {
          municipality: 'Orsa',
          decisionType: 'Tillstånd',
          wasteType: 'Schaktmassor',
          status: 'EMBEDDED',
          legalStatus: 'Aktiv',
          hazardousFlag: true,
          dateFrom: '2024-01-01',
          dateTo: '2024-12-31',
          extra: 123,
        },
      });

    expect(res.status).toBe(200);
    expect(mocks.runSearchQuery).toHaveBeenCalledWith({
      projectId: 'project-1',
      organisationId: 'org-1',
      userId: 'user-1',
      query: 'vatten',
      mode: 'lexical',
      topK: 5,
      strictEvidence: false,
      filters: {
        municipality: 'Orsa',
        decisionType: 'Tillstånd',
        wasteType: 'Schaktmassor',
        status: 'EMBEDDED',
        legalStatus: 'Aktiv',
        hazardousFlag: true,
        dateFrom: '2024-01-01',
        dateTo: '2024-12-31',
      },
    });
  });

  it('requires projectId for non-admin status but allows global admin status', async () => {
    const missing = await request(app)
      .get('/api/search/status')
      .set('Authorization', authHeader('CONSULTANT'));

    expect(missing.status).toBe(400);

    const admin = await request(app).get('/api/search/status').set('Authorization', authHeader('ADMIN'));

    expect(admin.status).toBe(200);
    expect(mocks.getSearchStatus).toHaveBeenCalledWith('org-1', undefined);

    const scoped = await request(app)
      .get('/api/search/status/project-1')
      .set('Authorization', authHeader('CONSULTANT'));

    expect(scoped.status).toBe(200);
    expect(mocks.assertProjectMembership).toHaveBeenCalledWith({
      projectId: 'project-1',
      userId: 'user-1',
      organisationId: 'org-1',
      role: 'CONSULTANT',
    });
    expect(mocks.getSearchStatus).toHaveBeenLastCalledWith('org-1', 'project-1');
  });

  it('clamps recover-stale parameters and processes requeued work', async () => {
    const missing = await request(app)
      .post('/api/search/recover-stale')
      .set('Authorization', authHeader('CONSULTANT'))
      .send({});

    expect(missing.status).toBe(400);

    const recovered = await request(app)
      .post('/api/search/recover-stale')
      .set('Authorization', authHeader('ADMIN'))
      .send({
        maxAgeMinutes: 1,
        limit: 9999,
      });

    expect(recovered.status).toBe(200);
    expect(mocks.recoverStaleRunningJobs).toHaveBeenCalledWith({
      projectId: undefined,
      maxAgeMinutes: 5,
      limit: 1000,
    });
    expect(mocks.processSearchJobsOnce).toHaveBeenCalledWith(2);
  });

  it('requires projectId for retry-failed and clamps limits', async () => {
    const missing = await request(app)
      .post('/api/search/retry-failed')
      .set('Authorization', authHeader('ADMIN'))
      .send({});

    expect(missing.status).toBe(400);

    const res = await request(app)
      .post('/api/search/retry-failed')
      .set('Authorization', authHeader('ADMIN'))
      .send({
        projectId: 'project-1',
        limit: 999,
      });

    expect(res.status).toBe(200);
    expect(mocks.requeueFailedJobs).toHaveBeenCalledWith('project-1', 500);
    expect(mocks.processSearchJobsOnce).toHaveBeenCalledWith(2);
  });

  it('returns search info metadata on GET /api/search/info', async () => {
    const res = await request(app).get('/api/search/info').set('Authorization', authHeader('CONSULTANT'));

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.info?.modes)).toBe(true);
  });

  it('allows admin query without projectId (global search)', async () => {
    const res = await request(app)
      .post('/api/search/query')
      .set('Authorization', authHeader('ADMIN'))
      .send({ query: 'miljö' });

    expect(res.status).toBe(200);
    expect(mocks.assertProjectMembership).not.toHaveBeenCalled();
    expect(mocks.runSearchQuery).toHaveBeenCalledWith(expect.objectContaining({ projectId: undefined }));
  });

  it('catches service errors in query and status routes', async () => {
    mocks.runSearchQuery.mockRejectedValueOnce(new Error('search engine failure'));
    const queryErr = await request(app)
      .post('/api/search/query')
      .set('Authorization', authHeader('ADMIN'))
      .send({ query: 'test' });
    expect(queryErr.status).toBe(400);

    mocks.getSearchStatus.mockRejectedValueOnce(new Error('db down'));
    const statusErr = await request(app).get('/api/search/status').set('Authorization', authHeader('ADMIN'));
    expect(statusErr.status).toBe(400);
  });

  it('uses custom manifestPath and outlookBaseDir from request body', async () => {
    const res = await request(app)
      .post('/api/search/sync-manifest')
      .set('Authorization', authHeader('ADMIN'))
      .send({
        projectId: 'project-1',
        manifestPath: '/custom/manifest.json',
        outlookBaseDir: '/custom/outlook',
      });

    expect(res.status).toBe(200);
    expect(mocks.enqueueSearchJob).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          manifestPath: '/custom/manifest.json',
          outlookBaseDir: '/custom/outlook',
        }),
      }),
    );
  });

  it('allows recover-stale with projectId for non-admin user', async () => {
    const res = await request(app)
      .post('/api/search/recover-stale')
      .set('Authorization', authHeader('CONSULTANT'))
      .send({ projectId: 'project-1' });

    expect(res.status).toBe(200);
    expect(mocks.assertProjectMembership).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'project-1' }),
    );
  });
});
