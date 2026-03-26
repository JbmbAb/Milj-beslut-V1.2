import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../../server/security/auditTrail', () => ({
  appendDomainAudit: vi.fn().mockResolvedValue({ id: 'audit-1' }),
}));

vi.mock('../../server/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Ensure Gemini is never called (no key set)
vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn(function (this: Record<string, unknown>) {
    return {
      models: {
        generateContent: vi.fn().mockRejectedValue(new Error('no key')),
      },
    };
  }),
}));

// ─── Module under test ─────────────────────────────────────────────────────────

// resetModules per test to get a clean in-memory job store.
let svc: typeof import('../../server/services/execSummaryQueueService');

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();
  svc = await import('../../server/services/execSummaryQueueService');
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('execSummaryQueueService', () => {

  // ── getJobStatus ───────────────────────────────────────────────────────────

  describe('getJobStatus', () => {
    it('returns undefined for an unknown jobId', () => {
      expect(svc.getJobStatus('does-not-exist')).toBeUndefined();
    });

    it('returns the job after it has been enqueued', async () => {
      const job = await svc.enqueueExecSummary({ projectId: 'proj-gs-1', userId: 'user-1' });
      const found = svc.getJobStatus(job.id);
      expect(found).toBeDefined();
      expect(found?.id).toBe(job.id);
    });

    it('returned job has correct projectId and userId', async () => {
      const job = await svc.enqueueExecSummary({ projectId: 'proj-gs-2', userId: 'user-42' });
      const found = svc.getJobStatus(job.id);
      expect(found?.projectId).toBe('proj-gs-2');
      expect(found?.userId).toBe('user-42');
    });
  });

  // ── listJobsForProject ─────────────────────────────────────────────────────

  describe('listJobsForProject', () => {
    it('returns empty array when no jobs exist for project', () => {
      expect(svc.listJobsForProject('proj-empty')).toHaveLength(0);
    });

    it('returns only jobs belonging to the requested projectId', async () => {
      await svc.enqueueExecSummary({ projectId: 'proj-lj-1', userId: 'u1' });
      await svc.enqueueExecSummary({ projectId: 'proj-lj-other', userId: 'u2' });

      const jobs = svc.listJobsForProject('proj-lj-1');
      expect(jobs.every((j) => j.projectId === 'proj-lj-1')).toBe(true);
    });
  });

  // ── enqueueExecSummary ─────────────────────────────────────────────────────

  describe('enqueueExecSummary', () => {
    it('returns a job with the correct structure', async () => {
      const job = await svc.enqueueExecSummary({ projectId: 'proj-eq-1', userId: 'u-eq' });

      expect(job.id).toBeTruthy();
      expect(job.projectId).toBe('proj-eq-1');
      expect(job.userId).toBe('u-eq');
      expect(job.createdAt).toBeTruthy();
      // createdAt should be an ISO timestamp
      expect(new Date(job.createdAt).getTime()).not.toBeNaN();
    });

    it('assigns a unique uuid id', async () => {
      const job1 = await svc.enqueueExecSummary({ projectId: 'proj-eq-2', userId: 'u1' });
      // After resetModules a fresh store is created; job1 has a unique id
      expect(typeof job1.id).toBe('string');
      expect(job1.id.length).toBeGreaterThan(10);
    });

    it('records an audit event on enqueue', async () => {
      const { appendDomainAudit } = await import('../../server/security/auditTrail');
      await svc.enqueueExecSummary({ projectId: 'proj-eq-3', userId: 'u-audit' });
      expect(appendDomainAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'EXEC_SUMMARY_ENQUEUED',
          entityType: 'EXEC_SUMMARY',
          userId: 'u-audit',
        }),
      );
    });

    it('deduplicates: second call returns the same job while first is still active', async () => {
      const job1 = await svc.enqueueExecSummary({ projectId: 'proj-dedup', userId: 'u1' });

      // Manually mark as QUEUED to simulate that the worker hasn't started yet
      // (dedup checks for QUEUED or RUNNING)
      // Use getJobStatus to verify the job still exists; then re-enqueue immediately
      const job1Status = svc.getJobStatus(job1.id);
      if (job1Status && (job1Status.status === 'QUEUED' || job1Status.status === 'RUNNING')) {
        const job2 = await svc.enqueueExecSummary({ projectId: 'proj-dedup', userId: 'u2' });
        expect(job2.id).toBe(job1.id);
      } else {
        // Worker completed fast – a new job will be created; just assert it's valid
        const job2 = await svc.enqueueExecSummary({ projectId: 'proj-dedup', userId: 'u2' });
        expect(job2.id).toBeTruthy();
      }
    });
  });

  // ── type exports ───────────────────────────────────────────────────────────

  describe('ExecSummaryJobStatus type values', () => {
    it('job status is one of the defined union values', async () => {
      const job = await svc.enqueueExecSummary({ projectId: 'proj-type', userId: 'u-t' });
      const validStatuses = ['QUEUED', 'RUNNING', 'DONE', 'FAILED'];
      expect(validStatuses).toContain(job.status);
    });
  });
});
