/**
 * Standalone worker for ingesting Domstol.se RSS feeds.
 *
 * To run: `ts-node -r dotenv/config server/workers/domstol-rss-worker.ts`
 */
import { loadEnvFile } from '../../server/loadEnv';
import { logger } from '../../server/logger';
import { startDomstolScheduler } from '../../server/services/domstolRssSchedulerService';
import { captureException } from '../../server/sentry';

loadEnvFile();

function main() {
  logger.info('domstol-rss-worker: Starting scheduler...');
  startDomstolScheduler();
}

try {
  main();
} catch (err) {
  logger.error('domstol-rss-worker: Failed to start', { error: String(err) });
  captureException(err, { context: 'domstol-rss-worker-start' });
}
