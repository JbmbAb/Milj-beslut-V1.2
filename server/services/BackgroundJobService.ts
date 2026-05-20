import { prisma } from '../db/prisma';
import { logger } from '../logger';

export type JobType = 'GDPR_MAINTENANCE' | 'SEARCH_INDEXING' | 'AI_GENERATION';

export async function createJob(type: JobType, payload?: any) {
  return prisma.backgroundJob.create({
    data: {
      type,
      payload,
      status: 'PENDING',
    },
  });
}

export async function startJob(jobId: string) {
  return prisma.backgroundJob.update({
    where: { id: jobId },
    data: {
      status: 'RUNNING',
      startedAt: new Date(),
    },
  });
}

export async function completeJob(jobId: string, result?: any) {
  return prisma.backgroundJob.update({
    where: { id: jobId },
    data: {
      status: 'COMPLETED',
      result,
      completedAt: new Date(),
    },
  });
}

export async function failJob(jobId: string, error: string) {
  return prisma.backgroundJob.update({
    where: { id: jobId },
    data: {
      status: 'FAILED',
      error,
      completedAt: new Date(),
    },
  });
}

/**
 * A simple runner that wraps a function and persists its status in the DB.
 */
export async function runReliableJob(type: JobType, payload: any, task: (payload: any) => Promise<any>) {
  const job = await createJob(type, payload);
  try {
    await startJob(job.id);
    const result = await task(payload);
    await completeJob(job.id, result);
    return result;
  } catch (err: any) {
    logger.error(`Job ${type} failed`, { jobId: job.id, error: err.message });
    await failJob(job.id, err.message);
    throw err;
  }
}
