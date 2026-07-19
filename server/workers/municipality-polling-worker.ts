/**
 * Fristående kommunstatus-polling.
 * Kör: npm run worker:municipality
 */
import { logger } from '../logger';
import { startMunicipalityStatusPolling } from '../services/municipalityStatusPolling';
import { bootstrapWorkerProcess } from './bootstrap';

bootstrapWorkerProcess();

function main(): void {
  const intervalMs = Math.max(60_000, Number(process.env.MUNICIPALITY_POLL_INTERVAL_MS || 6 * 60 * 60 * 1000));
  logger.info('municipality-worker: Starting status polling...', { intervalMs });
  startMunicipalityStatusPolling(intervalMs);
}

main();
