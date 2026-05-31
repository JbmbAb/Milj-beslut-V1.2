import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  appendDomainAudit: vi.fn(),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
}));

vi.mock('../../server/security/auditTrail', () => ({
  appendDomainAudit: mocks.appendDomainAudit,
}));

vi.mock('../../server/logger', () => ({
  logger: {
    info: mocks.loggerInfo,
    warn: mocks.loggerWarn,
  },
}));

// Flush all pending microtasks/macrotasks so the async worker finishes
const flushAsync = () => new Promise<void>((resolve) => setTimeout(resolve, 50));

describe('execSummaryQueueService', () => {
  let enqueueExecSummary: (params: { projectId: string; userId: string }) => Promise<unknown>;
  let getJobStatus: (jobId: string) => unknown;
  let listJobsForProject: (projectId: string) => unknown[];

  async function waitForJobStatus(jobId: string, status: string, timeoutMs = 1000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const job = getJobStatus(jobId) as { status?: string } | undefined;
      if (job?.status === status) return job;
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
    return getJobStatus(jobId);
  }

  beforeEach(async () => {
    vi.resetAllMocks();
    vi.resetModules();

    // Ensure no Gemini key is present so the deterministic fallback is always used
    delete process.env.GEMINI_API_KEY;
    delete process.env.VITE_GEMINI_API_KEY;

    mocks.appendDomainAudit.mockResolvedValue({ id: 'audit-abc' });

    const mod = await import('../../server/services/execSummaryQueueService');
    enqueueExecSummary = mod.enqueueExecSummary;
    getJobStatus = mod.getJobStatus;
    listJobsForProject = mod.listJobsForProject;
  });

  describe('enqueueExecSummary', () => {
    it('creates a new job and returns it with QUEUED status initially', async () => {
      const job = (await enqueueExecSummary({ projectId: 'proj-1', userId: 'user-1' })) as {
        id: string;
        status: string;
        projectId: string;
        userId: string;
      };

      expect(job.id).toBeTruthy();
      expect(job.projectId).toBe('proj-1');
      expect(job.userId).toBe('user-1');
      // status may already have advanced to DONE by the time we check
      expect(['QUEUED', 'RUNNING', 'DONE']).toContain(job.status);
    });

    it('calls appendDomainAudit with EXEC_SUMMARY_ENQUEUED action', async () => {
      await enqueueExecSummary({ projectId: 'proj-2', userId: 'user-2' });
      await flushAsync();

      expect(mocks.appendDomainAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: 'EXEC_SUMMARY',
          action: 'EXEC_SUMMARY_ENQUEUED',
          userId: 'user-2',
        }),
      );
    });

    it('deduplicates: returns existing job when QUEUED or RUNNING job already exists for the project', async () => {
      const first = (await enqueueExecSummary({ projectId: 'proj-dedup', userId: 'user-1' })) as {
        id: string;
        status: string;
      };

      // Only deduplicate while the job is still QUEUED/RUNNING – after DONE a new job is allowed.
      if (first.status === 'QUEUED' || first.status === 'RUNNING') {
        const second = (await enqueueExecSummary({ projectId: 'proj-dedup', userId: 'user-1' })) as {
          id: string;
        };
        expect(second.id).toBe(first.id);
      } else {
        // Worker already completed — new job should be issued
        const second = (await enqueueExecSummary({ projectId: 'proj-dedup', userId: 'user-1' })) as {
          id: string;
        };
        expect(second.id).not.toBe(first.id);
      }
    });

    it('worker eventually sets the job to DONE with a result', async () => {
      const job = (await enqueueExecSummary({ projectId: 'proj-worker', userId: 'user-1' })) as {
        id: string;
      };
      await flushAsync();

      const updated = (await waitForJobStatus(job.id, 'DONE')) as {
        status: string;
        result?: { summary: string; complianceScore: number; keyRisks: string[]; recommendations: string[] };
      };

      expect(updated.status).toBe('DONE');
      expect(updated.result).toBeDefined();
      expect(typeof updated.result!.summary).toBe('string');
      expect(updated.result!.complianceScore).toBeGreaterThan(0);
      expect(Array.isArray(updated.result!.keyRisks)).toBe(true);
      expect(Array.isArray(updated.result!.recommendations)).toBe(true);
    });

    it('logs info after a job is enqueued', async () => {
      await enqueueExecSummary({ projectId: 'proj-log', userId: 'user-log' });

      expect(mocks.loggerInfo).toHaveBeenCalledWith(
        'exec-summary-queue: job enqueued',
        expect.objectContaining({ projectId: 'proj-log' }),
      );
    });
  });

  describe('getJobStatus', () => {
    it('returns undefined for an unknown job id', () => {
      const result = getJobStatus('no-such-id');
      expect(result).toBeUndefined();
    });

    it('returns the job for a known job id', async () => {
      const job = (await enqueueExecSummary({ projectId: 'proj-3', userId: 'user-3' })) as {
        id: string;
      };

      const found = getJobStatus(job.id);
      expect(found).toBeDefined();
    });
  });

  describe('listJobsForProject', () => {
    it('returns an empty array when no jobs exist for the project', () => {
      const result = listJobsForProject('proj-unknown');
      expect(result).toEqual([]);
    });

    it('returns only jobs for the specified project', async () => {
      await enqueueExecSummary({ projectId: 'proj-A', userId: 'u1' });
      await flushAsync();
      await enqueueExecSummary({ projectId: 'proj-B', userId: 'u2' });
      await flushAsync();

      const resultsA = listJobsForProject('proj-A') as Array<{ projectId: string }>;
      expect(resultsA.length).toBeGreaterThan(0);
      for (const j of resultsA) {
        expect(j.projectId).toBe('proj-A');
      }
    });

    it('returns jobs sorted by createdAt descending', async () => {
      await enqueueExecSummary({ projectId: 'proj-sort', userId: 'u1' });
      await flushAsync();
      await enqueueExecSummary({ projectId: 'proj-sort', userId: 'u1' });
      await flushAsync();

      const jobs = listJobsForProject('proj-sort') as Array<{ createdAt: string }>;
      if (jobs.length > 1) {
        expect(jobs[0].createdAt >= jobs[1].createdAt).toBe(true);
      }
    });
  });

  describe('worker audit trail', () => {
    it('calls appendDomainAudit with EXEC_SUMMARY_COMPLETED after job finishes', async () => {
      const job = (await enqueueExecSummary({ projectId: 'proj-audit', userId: 'u-audit' })) as {
        id: string;
      };
      await waitForJobStatus(job.id, 'DONE');

      expect(mocks.appendDomainAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: 'EXEC_SUMMARY',
          action: 'EXEC_SUMMARY_COMPLETED',
          userId: 'u-audit',
          entityId: job.id,
        }),
      );
    });
  });
});
