/**
 * execSummaryQueueService.ts
 *
 * Asynkron kö för AI-generering av exekutiva sammanfattningar.
 *
 * Flödet:
 *   1. POST /api/projects/:projectId/exec-summary/enqueue  → returnerar jobId
 *   2. Worker kör genereringen i bakgrunden
 *   3. GET  /api/projects/:projectId/exec-summary/status/:jobId → status + resultat
 *
 * Implementeras med en in-process job-kö (kompatibel med searchWorker-mönstret).
 * I produktion ersätts detta med t.ex. BullMQ/Redis.
 */

import crypto from 'node:crypto';
import { logger } from '../logger';
import { appendDomainAudit } from '../security/auditTrail';

// ─── Types ───────────────────────────────────────────────────────────────────

export type ExecSummaryJobStatus = 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED';

export interface ExecSummaryJob {
  id: string;
  projectId: string;
  userId: string;
  status: ExecSummaryJobStatus;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  result?: ExecSummaryResult;
  error?: string;
}

export interface ExecSummaryResult {
  summary: string;
  keyRisks: string[];
  recommendations: string[];
  complianceScore: number;
  generatedAt: string;
}

// ─── In-process job store ─────────────────────────────────────────────────────

const jobs = new Map<string, ExecSummaryJob>();
let _workerRunning = false;

// ─── Queue management ─────────────────────────────────────────────────────────

/**
 * Enqueue a new executive summary job for a project.
 * Deduplicates: if a QUEUED or RUNNING job already exists for the project, returns it.
 */
export async function enqueueExecSummary(params: {
  projectId: string;
  userId: string;
}): Promise<ExecSummaryJob> {
  const existing = Array.from(jobs.values()).find(
    (j) => j.projectId === params.projectId && (j.status === 'QUEUED' || j.status === 'RUNNING'),
  );
  if (existing) return existing;

  const job: ExecSummaryJob = {
    id: crypto.randomUUID(),
    projectId: params.projectId,
    userId: params.userId,
    status: 'QUEUED',
    createdAt: new Date().toISOString(),
  };

  jobs.set(job.id, job);

  await appendDomainAudit({
    entityType: 'EXEC_SUMMARY',
    entityId: job.id,
    action: 'EXEC_SUMMARY_ENQUEUED',
    userId: params.userId,
    payload: { projectId: params.projectId },
  });

  logger.info('exec-summary-queue: job enqueued', { jobId: job.id, projectId: params.projectId });

  // Kick off the async worker (non-blocking)
  void runWorkerOnce();

  return job;
}

/**
 * Get the status + result of a specific job.
 */
export function getJobStatus(jobId: string): ExecSummaryJob | undefined {
  return jobs.get(jobId);
}

/**
 * List all jobs for a project.
 */
export function listJobsForProject(projectId: string): ExecSummaryJob[] {
  return Array.from(jobs.values())
    .filter((j) => j.projectId === projectId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ─── Worker ───────────────────────────────────────────────────────────────────

async function runWorkerOnce(): Promise<void> {
  if (_workerRunning) return;
  _workerRunning = true;

  try {
    const queued = Array.from(jobs.values()).filter((j) => j.status === 'QUEUED');

    for (const job of queued) {
      job.status = 'RUNNING';
      job.startedAt = new Date().toISOString();
      jobs.set(job.id, job);

      try {
        const result = await generateSummary(job.projectId);
        job.status = 'DONE';
        job.completedAt = new Date().toISOString();
        job.result = result;

        await appendDomainAudit({
          entityType: 'EXEC_SUMMARY',
          entityId: job.id,
          action: 'EXEC_SUMMARY_COMPLETED',
          userId: job.userId,
          payload: { projectId: job.projectId, complianceScore: result.complianceScore },
        });

        logger.info('exec-summary-queue: job completed', { jobId: job.id });
      } catch (err) {
        job.status = 'FAILED';
        job.completedAt = new Date().toISOString();
        job.error = err instanceof Error ? err.message : String(err);

        await appendDomainAudit({
          entityType: 'EXEC_SUMMARY',
          entityId: job.id,
          action: 'EXEC_SUMMARY_FAILED',
          userId: job.userId,
          payload: { projectId: job.projectId, error: job.error },
        });

        logger.warn('exec-summary-queue: job failed', { jobId: job.id, error: job.error });
      }

      jobs.set(job.id, job);
    }
  } finally {
    _workerRunning = false;
  }
}

// ─── AI generation (local/on-prem only) ──────────────────────────────────────

async function generateSummary(projectId: string): Promise<ExecSummaryResult> {
  // HD-03: no governed project-context loader is wired here yet. A production path must never
  // substitute a mock/canned summary for missing local generation or missing governed context.
  throw new Error(
    `exec-summary: generation is unavailable for project ${projectId} — governed project context and a governed local generation runtime are required (BLOCKED_BY_LOCAL_GENERATION_RUNTIME).`,
  );
}
