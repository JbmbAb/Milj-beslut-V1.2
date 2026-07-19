/**
 * Bakgrundsjobb — ska köras i separat process i produktion (Cloud Run Jobs / Scheduler).
 * HTTP-servern startar dem endast när START_WORKERS_IN_PROCESS !== 'false'.
 */

import { logger } from '../logger';
import { captureException } from '../sentry';
import { runGdprMaintenanceJob } from '../services/gdprComplianceService';
import { startMunicipalityStatusPolling } from '../services/municipalityStatusPolling';
import { startSearchWorker } from '../services/searchWorker';
import { startDomstolScheduler } from '../services/domstolRssSchedulerService';

export type WorkerRegistryHandle = {
  stop: () => void;
};

const MAINTENANCE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const MUNICIPALITY_POLL_INTERVAL_MS = 6 * 60 * 60 * 1000;

export function shouldStartWorkersInProcess(): boolean {
  if (process.env.START_WORKERS_IN_PROCESS === 'true') {
    return true;
  }
  if (process.env.START_WORKERS_IN_PROCESS === 'false') {
    return false;
  }

  // Default to disabled in production to avoid coupling worker crashes to API uptime.
  return process.env.NODE_ENV !== 'production';
}

export function startInProcessWorkers(): WorkerRegistryHandle {
  const intervals: NodeJS.Timeout[] = [];
  const timeouts: NodeJS.Timeout[] = [];

  intervals.push(
    setInterval(async () => {
      try {
        logger.info('Starting daily GDPR maintenance job...');
        await runGdprMaintenanceJob();
      } catch (error) {
        logger.error('GDPR maintenance job failed', { error: String(error) });
      }
    }, MAINTENANCE_INTERVAL_MS),
  );

  timeouts.push(
    setTimeout(async () => {
      try {
        await runGdprMaintenanceJob();
      } catch (error) {
        logger.error('Initial GDPR maintenance job failed', { error: String(error) });
        captureException(error, { context: 'initial-gdpr-maintenance' });
      }
    }, 10_000),
  );

  if (process.env.SEARCH_WORKER_ENABLED !== 'false') {
    const pollMs = Math.max(500, Number(process.env.SEARCH_WORKER_POLL_MS || 2500));
    const maxJobs = Math.max(1, Number(process.env.SEARCH_WORKER_MAX_JOBS || 3));
    startSearchWorker(pollMs, maxJobs);
    logger.info('Search indexer worker started in-process', { pollMs, maxJobs });
  }

  startMunicipalityStatusPolling(MUNICIPALITY_POLL_INTERVAL_MS);
  logger.info('Municipality status polling started in-process', {
    intervalMs: MUNICIPALITY_POLL_INTERVAL_MS,
  });

  if (process.env.DOMSTOL_RSS_ENABLED !== 'false') {
    try {
      startDomstolScheduler();
      logger.info('Domstol RSS scheduler started in-process');
    } catch (err) {
      logger.error('Failed to start domstol-rss scheduler', { error: String(err) });
      captureException(err, { context: 'domstol-rss-scheduler-start' });
    }
  }

  return {
    stop: () => {
      for (const id of intervals) clearInterval(id);
      for (const id of timeouts) clearTimeout(id);
    },
  };
}
