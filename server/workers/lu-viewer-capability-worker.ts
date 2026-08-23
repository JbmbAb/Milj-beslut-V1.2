/**
 * Fristående LU ViewerCapability provisioning-worker.
 * Kör: npm run worker:lu-viewer-capability
 *
 * The ONLY process that should ever have VIEWER_CAPABILITY_ISSUER_PRIVATE_KEY_PEM set.
 */
import { logger } from '../logger';
import { startViewerCapabilityProvisioningWorker } from '../services/luViewerCapabilityProvisioningWorker';
import { bootstrapWorkerProcess } from './bootstrap';

bootstrapWorkerProcess();

function main(): void {
  if (!process.env.VIEWER_CAPABILITY_ISSUER_PRIVATE_KEY_PEM) {
    logger.error('lu-viewer-capability-worker: VIEWER_CAPABILITY_ISSUER_PRIVATE_KEY_PEM is not set -- refusing to start.');
    process.exit(1);
  }
  logger.info('lu-viewer-capability-worker: Starting LU ViewerCapability provisioning worker...');
  const pollMs = Math.max(1000, Number(process.env.LU_VIEWER_CAPABILITY_WORKER_POLL_MS || 5000));
  startViewerCapabilityProvisioningWorker(pollMs);
  logger.info(`lu-viewer-capability-worker: Polling for requests every ${pollMs}ms.`);
}

main();
