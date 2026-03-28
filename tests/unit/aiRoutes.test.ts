import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTokenPair } from '../../server/security/auth';

const mocks = vi.hoisted(() => ({
  runRagSearch: vi.fn(),
  enqueueExecSummary: vi.fn(),
  getExecSummaryJobStatus: vi.fn(),
  listExecSummaryJobs: vi.fn(),
  assertPermission: vi.fn(),
}));

vi.mock('../../server/repositories/tokenRepository', () => ({
  isTokenRevoked: vi.fn(async () => false),
}));

vi.mock('../../server/services/ragSearchService', () => ({
  runRagSearch: mocks.runRagSearch,
}));

vi.mock('../../server/services/execSummaryQueueService', () => ({
  enqueueExecSummary: mocks.enqueueExecSummary,
  getJobStatus: mocks.getExecSummaryJobStatus,
  listJobsForProject: mocks.listExecSummaryJobs,
}));

vi.mock('../../server/security/projectAccess', () => ({
  assertPermission: mocks.assertPermission,
}));

import aiRoutes from '../../server/routes/ai.routes';

const app = express();
app.use(express.json());
app.use(aiRoutes);

function authHeader(role: 'ADMIN' | 'CONSULTANT' = 'CONSULTANT') {
  return `Bearer ${
    createTokenPair({
      id: role === 'ADMIN' ? 'admin-1' : 'user-1',
      organisationId: 'org-1',
      bankidId: role === 'ADMIN' ? 'admin:one' : 'consultant:one',
      role,
    }).accessToken
  }`;
}

describe('ai.routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertPermission.mockResolvedValue(undefined);
  });

  afterEach(() => {
    // any cleanup
  });

  describe('POST /api/search/rag', () => {
    it('returns 401 for unauthenticated users', async () => {
      const res = await request(app).post('/api/search/rag').send({ query: 'test' });
      expect(res.status).toBe(401);
    });

    it('returns 400 if query is missing', async () => {
      const res = await request(app).post('/api/search/rag').set('Authorization', authHeader()).send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('query krävs');
    });

    it('calls runRagSearch with the correct parameters', async () => {
      mocks.runRagSearch.mockResolvedValue({ results: [] });
      const res = await request(app)
        .post('/api/search/rag')
        .set('Authorization', authHeader())
        .send({ query: 'test query', projectId: 'proj-1', limit: 5, language: 'en' });

      expect(res.status).toBe(200);
      expect(mocks.runRagSearch).toHaveBeenCalledWith({
        query: 'test query',
        organisationId: 'org-1',
        projectId: 'proj-1',
        limit: 5,
        language: 'en',
      });
      expect(res.body.result).toEqual({ results: [] });
    });

    it('handles errors from runRagSearch', async () => {
      mocks.runRagSearch.mockRejectedValue(new Error('RAG failed'));
      const res = await request(app)
        .post('/api/search/rag')
        .set('Authorization', authHeader())
        .send({ query: 'test query' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('An error occurred processing your request');
    });
  });

  describe('POST /api/projects/:projectId/exec-summary/enqueue', () => {
    it('returns 401 for unauthenticated users', async () => {
      const res = await request(app).post('/api/projects/proj-1/exec-summary/enqueue');
      expect(res.status).toBe(401);
    });

    it('enqueues a job and returns it', async () => {
      const job = { id: 'job-1', status: 'queued' };
      mocks.enqueueExecSummary.mockResolvedValue(job);
      const res = await request(app)
        .post('/api/projects/proj-1/exec-summary/enqueue')
        .set('Authorization', authHeader());

      expect(res.status).toBe(200);
      expect(mocks.enqueueExecSummary).toHaveBeenCalledWith({
        projectId: 'proj-1',
        userId: 'user-1',
      });
      expect(mocks.assertPermission).toHaveBeenCalledWith(expect.anything(), 'proj-1');
      expect(res.body.job).toEqual(job);
    });

    it('handles errors from enqueueExecSummary', async () => {
      mocks.enqueueExecSummary.mockRejectedValue(new Error('Enqueue failed'));
      const res = await request(app)
        .post('/api/projects/proj-1/exec-summary/enqueue')
        .set('Authorization', authHeader());

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('An error occurred processing your request');
    });
  });

  describe('GET /api/projects/:projectId/exec-summary/status/:jobId', () => {
    it('returns 401 for unauthenticated users', async () => {
      const res = await request(app).get('/api/projects/proj-1/exec-summary/status/job-1');
      expect(res.status).toBe(401);
    });

    it('returns a job status', async () => {
      const job = { id: 'job-1', status: 'processing' };
      mocks.getExecSummaryJobStatus.mockReturnValue(job);
      const res = await request(app)
        .get('/api/projects/proj-1/exec-summary/status/job-1')
        .set('Authorization', authHeader());

      expect(res.status).toBe(200);
      expect(mocks.getExecSummaryJobStatus).toHaveBeenCalledWith('job-1');
      expect(res.body.job).toEqual(job);
    });

    it('returns 404 if job is not found', async () => {
      mocks.getExecSummaryJobStatus.mockReturnValue(null);
      const res = await request(app)
        .get('/api/projects/proj-1/exec-summary/status/job-1')
        .set('Authorization', authHeader());

      expect(res.status).toBe(404);
    });

    it('handles errors from getExecSummaryJobStatus', async () => {
      mocks.getExecSummaryJobStatus.mockImplementation(() => {
        throw new Error('Get status failed');
      });
      const res = await request(app)
        .get('/api/projects/proj-1/exec-summary/status/job-1')
        .set('Authorization', authHeader());

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('An error occurred processing your request');
    });
  });

  describe('GET /api/projects/:projectId/exec-summary/jobs', () => {
    it('returns 401 for unauthenticated users', async () => {
      const res = await request(app).get('/api/projects/proj-1/exec-summary/jobs');
      expect(res.status).toBe(401);
    });

    it('returns a list of jobs', async () => {
      const jobs = [{ id: 'job-1', status: 'completed' }];
      mocks.listExecSummaryJobs.mockReturnValue(jobs);
      const res = await request(app)
        .get('/api/projects/proj-1/exec-summary/jobs')
        .set('Authorization', authHeader());

      expect(res.status).toBe(200);
      expect(mocks.listExecSummaryJobs).toHaveBeenCalledWith('proj-1');
      expect(mocks.assertPermission).toHaveBeenCalledWith(expect.anything(), 'proj-1');
      expect(res.body.jobs).toEqual(jobs);
    });

    it('handles errors from listExecSummaryJobs', async () => {
      mocks.listExecSummaryJobs.mockImplementation(() => {
        throw new Error('List jobs failed');
      });
      const res = await request(app)
        .get('/api/projects/proj-1/exec-summary/jobs')
        .set('Authorization', authHeader());

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('An error occurred processing your request');
    });
  });
});
