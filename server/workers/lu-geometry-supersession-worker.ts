/**
 * Fristående LU LocalizationGeometrySupersession provisioning-worker.
 * Kör: npm run worker:lu-geometry-supersession
 *
 * The ONLY process that should ever have LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_PRIVATE_KEY_PEM set.
 */
import { logger } from '../logger';
import { startGeometrySupersessionProvisioningWorker } from '../services/luGeometrySupersessionProvisioningWorker';
import { bootstrapWorkerProcess } from './bootstrap';

bootstrapWorkerProcess();

function main(): void {
  if (!process.env.LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_PRIVATE_KEY_PEM) {
    logger.error('lu-geometry-supersession-worker: LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_PRIVATE_KEY_PEM is not set -- refusing to start.');
    process.exit(1);
  }
  logger.info('lu-geometry-supersession-worker: Starting LU geometry supersession provisioning worker...');
  const pollMs = Math.max(1000, Number(process.env.LU_GEOMETRY_SUPERSESSION_WORKER_POLL_MS || 5000));
  startGeometrySupersessionProvisioningWorker(pollMs);
  logger.info(`lu-geometry-supersession-worker: Polling for requests every ${pollMs}ms.`);
}

main();
