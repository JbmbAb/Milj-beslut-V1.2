/**
 * Fristående LU project-context bootstrap-worker.
 * Kör: npm run worker:lu-bootstrap
 *
 * The ONLY process that should ever have PROJECT_CONTEXT_BINDING_ISSUER_PRIVATE_KEY_PEM set.
 */
import { logger } from '../logger';
import { startLuProjectContextBootstrapWorker } from '../services/luProjectContextBootstrapWorker';
import {
  assertLuWorkerBootstrapAdmitFlag,
  assertLuWorkerDurableCas,
  assertLuWorkerProductReleaseIdentity,
  bootstrapWorkerProcess,
} from './bootstrap';

bootstrapWorkerProcess();

async function main(): Promise<void> {
  // W-U402 (U40-2, K7): MPS_LU_BOOTSTRAP_ADMIT outside an explicit test process refuses the start, before anything else.
  await assertLuWorkerBootstrapAdmitFlag('lu-bootstrap-worker');
  if (!process.env.PROJECT_CONTEXT_BINDING_ISSUER_PRIVATE_KEY_PEM) {
    logger.error('lu-bootstrap-worker: PROJECT_CONTEXT_BINDING_ISSUER_PRIVATE_KEY_PEM is not set -- refusing to start.');
    process.exit(1);
  }
  await assertLuWorkerDurableCas('lu-bootstrap-worker');
  // W-U42: the worker runs only the build its configured product release was issued for.
  await assertLuWorkerProductReleaseIdentity('lu-bootstrap-worker');
  logger.info('lu-bootstrap-worker: Starting LU project-context bootstrap worker...');
  const pollMs = Math.max(1000, Number(process.env.LU_BOOTSTRAP_WORKER_POLL_MS || 5000));
  startLuProjectContextBootstrapWorker(pollMs);
  logger.info(`lu-bootstrap-worker: Polling for requests every ${pollMs}ms.`);
}

main().catch((error: unknown) => {
  logger.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
