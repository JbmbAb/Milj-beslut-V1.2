/**
 * Fristående LU ViewerCapability provisioning-worker.
 * Kör: npm run worker:lu-viewer-capability
 *
 * The ONLY process that should ever have VIEWER_CAPABILITY_ISSUER_PRIVATE_KEY_PEM set.
 */
import { logger } from '../logger';
import { startViewerCapabilityProvisioningWorker } from '../services/luViewerCapabilityProvisioningWorker';
import { assertLuWorkerDurableCas, assertLuWorkerProductReleaseIdentity, bootstrapWorkerProcess } from './bootstrap';

bootstrapWorkerProcess();

async function main(): Promise<void> {
  if (!process.env.VIEWER_CAPABILITY_ISSUER_PRIVATE_KEY_PEM) {
    logger.error('lu-viewer-capability-worker: VIEWER_CAPABILITY_ISSUER_PRIVATE_KEY_PEM is not set -- refusing to start.');
    process.exit(1);
  }
  await assertLuWorkerDurableCas('lu-viewer-capability-worker');
  // W-U42: the worker runs only the build its configured product release was issued for.
  await assertLuWorkerProductReleaseIdentity('lu-viewer-capability-worker');
  logger.info('lu-viewer-capability-worker: Starting LU ViewerCapability provisioning worker...');
  const pollMs = Math.max(1000, Number(process.env.LU_VIEWER_CAPABILITY_WORKER_POLL_MS || 5000));
  startViewerCapabilityProvisioningWorker(pollMs);
  logger.info(`lu-viewer-capability-worker: Polling for requests every ${pollMs}ms.`);
}

main().catch((error: unknown) => {
  logger.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
