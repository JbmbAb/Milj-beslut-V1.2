import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTokenPair } from '../../server/security/auth';

const mocks = vi.hoisted(() => ({
  runRagSearch: vi.fn(),
  enqueueExecSummary: vi.fn(),
  getJobStatus: vi.fn(),
  listJobsForProject: vi.fn(),
  assertPermission: vi.fn(),
}));

vi.mock('../../server/repositories/tokenRepository', () => ({
  isTokenRevoked: vi.fn(async () => false),
  markRefreshTokenAsUsed: vi.fn(async () => undefined),
  revokeRefreshToken: vi.fn(async () => undefined),
  cleanupExpiredTokenRevocations: vi.fn(async () => 0),
}));

vi.mock('../../server/services/ragSearchService', () => ({
  runRagSearch: mocks.runRagSearch,
}));

vi.mock('../../server/services/execSummaryQueueService', () => ({
  enqueueExecSummary: mocks.enqueueExecSummary,
  getJobStatus: mocks.getJobStatus,
  listJobsForProject: mocks.listJobsForProject,
}));

vi.mock('../../server/security/projectAccess', () => ({
  assertPermission: mocks.assertPermission,
}));

import aiRoutes from '../../server/routes/ai.routes';

const app = express();
app.use(express.json());
app.use(aiRoutes);

function authHeader(role: 'ADMIN' | 'CONSULTANT' = 'ADMIN') {
  return `Bearer ${
    createTokenPair({
      id: 'user-1',
      organisationId: 'org-1',
      bankidId: 'user:one',
      role,
    }).accessToken
  }`;
}

describe('ai.routes – RAG search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertPermission.mockResolvedValue(undefined);
    mocks.runRagSearch.mockResolvedValue({ hits: [], totalCount: 0 });
    mocks.enqueueExecSummary.mockResolvedValue({ jobId: 'job-1', status: 'queued' });
    mocks.getJobStatus.mockReturnValue({ jobId: 'job-1', status: 'done' });
    mocks.listJobsForProject.mockReturnValue([{ jobId: 'job-1', status: 'done' }]);
  });

  it('returns 401 without auth token', async () => {
    const res = await request(app).post('/api/search/rag').send({ query: 'test' });
    expect(res.status).toBe(401);
  });

  it('returns 400 when query is missing', async () => {
    const res = await request(app).post('/api/search/rag').set('Authorization', authHeader()).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/query/i);
  });

  it('returns 400 when query is blank', async () => {
    const res = await request(app)
      .post('/api/search/rag')
      .set('Authorization', authHeader())
      .send({ query: '   ' });
    expect(res.status).toBe(400);
  });

  it('calls ragSearchService with correct params and returns result', async () => {
    const res = await request(app)
      .post('/api/search/rag')
      .set('Authorization', authHeader())
      .send({ query: 'miljötillstånd', projectId: 'proj-1', limit: 5 });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(mocks.runRagSearch).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'miljötillstånd', projectId: 'proj-1', limit: 5 }),
    );
  });

  it('defaults language to sv', async () => {
    await request(app).post('/api/search/rag').set('Authorization', authHeader()).send({ query: 'test' });

    expect(mocks.runRagSearch).toHaveBeenCalledWith(expect.objectContaining({ language: 'sv' }));
  });

  it('passes en language when specified', async () => {
    await request(app)
      .post('/api/search/rag')
      .set('Authorization', authHeader())
      .send({ query: 'test', language: 'en' });

    expect(mocks.runRagSearch).toHaveBeenCalledWith(expect.objectContaining({ language: 'en' }));
  });

  it('returns 400 on service failure', async () => {
    mocks.runRagSearch.mockRejectedValueOnce(new Error('search failed'));
    const res = await request(app)
      .post('/api/search/rag')
      .set('Authorization', authHeader())
      .send({ query: 'test' });
    expect(res.status).toBe(400);
  });
});

describe('ai.routes – executive summary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertPermission.mockResolvedValue(undefined);
    mocks.enqueueExecSummary.mockResolvedValue({ jobId: 'job-1', status: 'queued' });
    mocks.getJobStatus.mockReturnValue({ jobId: 'job-1', status: 'done' });
    mocks.listJobsForProject.mockReturnValue([{ jobId: 'job-1', status: 'done' }]);
  });

  it('enqueues an exec summary job', async () => {
    const res = await request(app)
      .post('/api/projects/proj-1/exec-summary/enqueue')
      .set('Authorization', authHeader())
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(mocks.enqueueExecSummary).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'proj-1', userId: 'user-1' }),
    );
  });

  it('returns 401 on enqueue without auth', async () => {
    const res = await request(app).post('/api/projects/proj-1/exec-summary/enqueue').send({});
    expect(res.status).toBe(401);
  });

  it('returns 400 on enqueue when assertPermission throws', async () => {
    mocks.assertPermission.mockRejectedValueOnce(new Error('forbidden'));
    const res = await request(app)
      .post('/api/projects/proj-1/exec-summary/enqueue')
      .set('Authorization', authHeader())
      .send({});
    expect(res.status).toBe(400);
  });

  it('returns job status by jobId', async () => {
    const res = await request(app)
      .get('/api/projects/proj-1/exec-summary/status/job-1')
      .set('Authorization', authHeader());

    expect(res.status).toBe(200);
    expect(res.body.job.jobId).toBe('job-1');
  });

  it('returns 404 when job not found', async () => {
    mocks.getJobStatus.mockReturnValueOnce(undefined);
    const res = await request(app)
      .get('/api/projects/proj-1/exec-summary/status/unknown-job')
      .set('Authorization', authHeader());
    expect(res.status).toBe(404);
  });

  it('lists jobs for a project', async () => {
    const res = await request(app)
      .get('/api/projects/proj-1/exec-summary/jobs')
      .set('Authorization', authHeader());

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.jobs)).toBe(true);
    expect(mocks.listJobsForProject).toHaveBeenCalledWith('proj-1');
  });

  it('returns 401 listing jobs without auth', async () => {
    const res = await request(app).get('/api/projects/proj-1/exec-summary/jobs');
    expect(res.status).toBe(401);
  });

  it('returns 400 on listJobs when assertPermission throws', async () => {
    mocks.assertPermission.mockRejectedValueOnce(new Error('no access'));
    const res = await request(app)
      .get('/api/projects/proj-1/exec-summary/jobs')
      .set('Authorization', authHeader());
    expect(res.status).toBe(400);
  });

  it('returns 401 on status without auth', async () => {
    const res = await request(app).get('/api/projects/proj-1/exec-summary/status/job-1');
    expect(res.status).toBe(401);
  });
});
