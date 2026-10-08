/**
 * Fristående LU ExecutionIdentity V3 provisioning-worker.
 * Kör: npm run worker:lu-identity-v3
 *
 * The ONLY process that should ever have LU_EXECUTION_AUTHORITY_PRIVATE_KEY_PEM set.
 * 04E also makes this worker the issuer-side owner of exact-attempt temporal authorization.
 */
import { logger } from '../logger';
import { startLocalizationIdentityProvisioningWorker } from '../services/luExecutionIdentityV3ProvisioningWorker';
import {
  assertLuWorkerBootstrapAdmitFlag,
  assertLuWorkerDurableCas,
  assertLuWorkerProductReleaseIdentity,
  bootstrapWorkerProcess,
} from './bootstrap';

bootstrapWorkerProcess();

async function main(): Promise<void> {
  // W-U402 (U40-2, K7): MPS_LU_BOOTSTRAP_ADMIT outside an explicit test process refuses the start, before anything else.
  await assertLuWorkerBootstrapAdmitFlag('lu-identity-v3-worker');
  if (!process.env.LU_EXECUTION_AUTHORITY_PRIVATE_KEY_PEM) {
    logger.error('lu-identity-v3-worker: LU_EXECUTION_AUTHORITY_PRIVATE_KEY_PEM is not set -- refusing to start.');
    process.exit(1);
  }
  if (!process.env.LU_EXECUTION_AUTHORITY_LIFECYCLE_ID?.trim()) {
    logger.error('lu-identity-v3-worker: LU_EXECUTION_AUTHORITY_LIFECYCLE_ID is not set -- refusing to start.');
    process.exit(1);
  }
  await assertLuWorkerDurableCas('lu-identity-v3-worker');
  // W-U42: the worker runs only the build its configured product release was issued for.
  await assertLuWorkerProductReleaseIdentity('lu-identity-v3-worker');

  logger.info('lu-identity-v3-worker: Starting LU ExecutionIdentity V3 + lifecycle-bound temporal-authority provisioning worker...');
  const pollMs = Math.max(1000, Number(process.env.LU_IDENTITY_V3_WORKER_POLL_MS || 5000));
  startLocalizationIdentityProvisioningWorker(pollMs);
  logger.info(`lu-identity-v3-worker: Polling for requests every ${pollMs}ms.`);
}

main().catch((error: unknown) => {
  logger.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
