import {
  getNextPendingJob,
  markJobDone,
  markJobFailedOrRetry,
  markJobRunning,
  recoverStaleRunningJobs,
  setDocumentStatus,
} from '../repositories/searchRepository';
import { embedDocumentChunks, extractDocumentTextAndChunk, syncManifestMetadata } from './searchService';

let activeRun = false;
let intervalHandle: NodeJS.Timeout | null = null;
let lastRecoveryAt = 0;

const SEARCH_JOB_MAX_ATTEMPTS = Math.max(1, Math.min(10, Number(process.env.SEARCH_JOB_MAX_ATTEMPTS || 3)));
const STALE_RUNNING_MINUTES = Math.max(
  5,
  Math.min(24 * 60, Number(process.env.SEARCH_JOB_STALE_MINUTES || 30)),
);
const STALE_RECOVERY_LIMIT = Math.max(
  1,
  Math.min(1000, Number(process.env.SEARCH_JOB_STALE_RECOVERY_LIMIT || 200)),
);
const STALE_RECOVERY_INTERVAL_MS = Math.max(
  30_000,
  Number(process.env.SEARCH_JOB_RECOVERY_INTERVAL_MS || 120_000),
);

function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export async function processSearchJobsOnce(
  maxJobs: number = 1,
  forceType?: 'SYNC_MANIFEST' | 'EXTRACT_TEXT' | 'EMBED_DOC',
): Promise<number> {
  if (activeRun) {
    return 0;
  }

  activeRun = true;
  let processed = 0;

  try {
    if (Date.now() - lastRecoveryAt >= STALE_RECOVERY_INTERVAL_MS) {
      await recoverStaleRunningJobs({
        maxAgeMinutes: STALE_RUNNING_MINUTES,
        limit: STALE_RECOVERY_LIMIT,
      }).catch(() => 0);
      lastRecoveryAt = Date.now();
    }

    const jobPromises: Promise<void>[] = [];
    const jobIdsSeen = new Set<string>();

    for (let i = 0; i < maxJobs; i += 1) {
      // Prevent long EXTRACT_TEXT queues from starving semantic embedding jobs.
      const preferredType = forceType || (i === 0 ? 'EMBED_DOC' : undefined);
      const job = await getNextPendingJob(preferredType);

      if (!job || jobIdsSeen.has(String(job.id))) {
        break;
      }
      jobIdsSeen.add(String(job.id));

      jobPromises.push(
        (async () => {
          const jobId = String(job.id);
          const payload = (job.payload || {}) as Record<string, unknown>;
          const documentId = typeof payload.documentId === 'string' ? payload.documentId : '';

          try {
            await markJobRunning(jobId);

            if (job.type === 'SYNC_MANIFEST') {
              await syncManifestMetadata({
                projectId: String(job.projectId || payload.projectId || ''),
                organisationId: String(payload.organisationId || ''),
                manifestPath: typeof payload.manifestPath === 'string' ? payload.manifestPath : undefined,
                outlookBaseDir:
                  typeof payload.outlookBaseDir === 'string' ? payload.outlookBaseDir : undefined,
              });
            } else if (job.type === 'EXTRACT_TEXT') {
              if (!documentId) throw new Error('Missing documentId in EXTRACT_TEXT payload');
              await extractDocumentTextAndChunk(documentId);
            } else if (job.type === 'EMBED_DOC') {
              if (!documentId) throw new Error('Missing documentId in EMBED_DOC payload');
              await embedDocumentChunks(documentId);
            } else {
              throw new Error(`Unsupported job type: ${String(job.type)}`);
            }

            await markJobDone(jobId);
            processed += 1;
          } catch (error: unknown) {
            if (documentId) {
              if (job.type === 'EMBED_DOC') {
                await setDocumentStatus(documentId, 'TEXT_EXTRACTED').catch(() => undefined);
              } else {
                await setDocumentStatus(documentId, 'FAILED').catch(() => undefined);
              }
            }
            await markJobFailedOrRetry(jobId, safeErrorMessage(error), SEARCH_JOB_MAX_ATTEMPTS);
          }
        })(),
      );
    }

    if (jobPromises.length > 0) {
      await Promise.all(jobPromises);
    }
  } finally {
    activeRun = false;
  }

  return processed;
}

export function startSearchWorker(pollMs: number = 2500, maxJobsPerTick: number = 3) {
  if (intervalHandle) {
    return;
  }
  intervalHandle = setInterval(() => {
    processSearchJobsOnce(maxJobsPerTick).catch(() => undefined);
  }, pollMs);
}

export function stopSearchWorker() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
