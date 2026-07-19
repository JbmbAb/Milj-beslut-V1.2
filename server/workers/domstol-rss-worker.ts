/**
 * Fristående Domstol RSS-scheduler.
 * Kör: npm run worker:domstol-rss
 */
import { logger } from '../logger';
import { startDomstolScheduler } from '../services/domstolRssSchedulerService';
import { bootstrapWorkerProcess } from './bootstrap';

bootstrapWorkerProcess();

function main(): void {
  logger.info('domstol-rss-worker: Starting scheduler...');
  startDomstolScheduler();
  logger.info('domstol-rss-worker: Scheduler active.');
}

main();
