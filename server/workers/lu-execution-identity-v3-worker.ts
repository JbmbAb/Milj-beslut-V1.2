/**
 * Fristående LU ExecutionIdentity V3 provisioning-worker.
 * Kör: npm run worker:lu-identity-v3
 *
 * The ONLY process that should ever have LU_EXECUTION_AUTHORITY_PRIVATE_KEY_PEM set.
 * 04E also makes this worker the issuer-side owner of exact-attempt temporal authorization.
 */
import { logger } from '../logger';
import { startLocalizationIdentityProvisioningWorker } from '../services/luExecutionIdentityV3ProvisioningWorker';
import { bootstrapWorkerProcess } from './bootstrap';

bootstrapWorkerProcess();

function main(): void {
  if (!process.env.LU_EXECUTION_AUTHORITY_PRIVATE_KEY_PEM) {
    logger.error('lu-identity-v3-worker: LU_EXECUTION_AUTHORITY_PRIVATE_KEY_PEM is not set -- refusing to start.');
    process.exit(1);
  }
  if (!process.env.LU_EXECUTION_AUTHORITY_LIFECYCLE_ID?.trim()) {
    logger.error('lu-identity-v3-worker: LU_EXECUTION_AUTHORITY_LIFECYCLE_ID is not set -- refusing to start.');
    process.exit(1);
  }

  logger.info('lu-identity-v3-worker: Starting LU ExecutionIdentity V3 + lifecycle-bound temporal-authority provisioning worker...');
  const pollMs = Math.max(1000, Number(process.env.LU_IDENTITY_V3_WORKER_POLL_MS || 5000));
  startLocalizationIdentityProvisioningWorker(pollMs);
  logger.info(`lu-identity-v3-worker: Polling for requests every ${pollMs}ms.`);
}

main();
