/**
 * Standalone worker for search indexing.
 *
 * To run: `ts-node -r dotenv/config server/workers/search-indexer-worker.ts`
 */
import { loadEnvFile } from '../../server/loadEnv';
import { logger } from '../../server/logger';
import { startSearchWorker } from '../../server/services/searchWorker';

loadEnvFile();

function main() {
  logger.info('search-worker: Starting search indexer worker...');
  const pollMs = Math.max(500, Number(process.env.SEARCH_WORKER_POLL_MS || 2500));
  const maxJobs = Math.max(1, Number(process.env.SEARCH_WORKER_MAX_JOBS || 3));
  startSearchWorker(pollMs, maxJobs);
  logger.info(`search-worker: Polling for jobs every ${pollMs}ms.`);
}

main();
