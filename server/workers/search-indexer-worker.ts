/**
 * Fristående sökindexerings-worker.
 * Kör: npm run worker:search
 */
import { logger } from '../logger';
import { startSearchWorker } from '../services/searchWorker';
import { bootstrapWorkerProcess } from './bootstrap';

bootstrapWorkerProcess();

function main(): void {
  logger.info('search-worker: Starting search indexer worker...');
  const pollMs = Math.max(500, Number(process.env.SEARCH_WORKER_POLL_MS || 2500));
  const maxJobs = Math.max(1, Number(process.env.SEARCH_WORKER_MAX_JOBS || 3));
  startSearchWorker(pollMs, maxJobs);
  logger.info(`search-worker: Polling for jobs every ${pollMs}ms (maxJobs=${maxJobs}).`);
}

main();
