import http from 'http';
import { loadEnvFile } from './loadEnv';
import { logger } from './logger';
import { createApp } from './createApp';
import { initializeWebSocketServer } from './websocket';
import { captureException } from './sentry';
import { runGdprMaintenanceJob } from './services/gdprComplianceService';
import { startMunicipalityStatusPolling } from './services/municipalityStatusPolling';
import { startSearchWorker } from './services/searchWorker';
import { startDomstolScheduler } from './services/domstolRssSchedulerService';
import { warnProductionDevFlags } from './warnProductionDevFlags';

loadEnvFile();
const preserveRuntimeEnv =
  process.env.PRESERVE_RUNTIME_ENV === 'true' ||
  Boolean(process.env.PLAYWRIGHT_LOCAL_API_PORT) ||
  process.env.NODE_ENV === 'test';
loadEnvFile('.env.local', { overrideExisting: !preserveRuntimeEnv });
warnProductionDevFlags();

export const app = createApp();
const port = Number(process.env.PORT || 8787);

const server = http.createServer(app);

// Skapa servern men starta den bara om vi inte är i testmiljö.
// Vitest importerar denna fil för att få 'app'-instansen.
if (process.env.NODE_ENV !== 'test') {
  initializeWebSocketServer(server);

  // In-process workers and schedulers. In a real cloud environment, these would
  // be disabled here and run as separate services (e.g., separate Cloud Run jobs).
  const startWorkersInProcess = process.env.START_WORKERS_IN_PROCESS !== 'false';
  if (startWorkersInProcess) {
    const MAINTENANCE_INTERVAL = 24 * 60 * 60 * 1000;
    setInterval(async () => {
      try {
        logger.info('Starting daily GDPR maintenance job...');
        await runGdprMaintenanceJob();
      } catch (error) {
        logger.error('GDPR maintenance job failed', { error: String(error) });
      }
    }, MAINTENANCE_INTERVAL);

    setTimeout(async () => {
      try {
        await runGdprMaintenanceJob();
      } catch (error) {
        logger.error('Initial GDPR maintenance job failed', { error: String(error) });
        captureException(error, { context: 'initial-gdpr-maintenance' });
      }
    }, 10000); // Delay initial run slightly

    if (process.env.SEARCH_WORKER_ENABLED !== 'false') {
      const pollMs = Math.max(500, Number(process.env.SEARCH_WORKER_POLL_MS || 2500));
      const maxJobs = Math.max(1, Number(process.env.SEARCH_WORKER_MAX_JOBS || 3));
      startSearchWorker(pollMs, maxJobs);
    }

    const MUNICIPALITY_POLL_INTERVAL = 6 * 60 * 60 * 1000;
    startMunicipalityStatusPolling(MUNICIPALITY_POLL_INTERVAL);

    if (process.env.DOMSTOL_RSS_ENABLED !== 'false') {
      try {
        startDomstolScheduler();
      } catch (err) {
        logger.error('Failed to start domstol-rss scheduler', { error: String(err) });
        captureException(err, { context: 'domstol-rss-scheduler-start' });
      }
    }
  }

  server.listen(port, () => {
    logger.info('Miljöbeslut backend started with WebSocket support', { port });
  });
}
