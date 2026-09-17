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

const REQUIRED_TEMPORAL_ENV = [
  'LU_SOURCE_AUTHORITY_VALID_FROM',
  'LU_SOURCE_AUTHORITY_VALID_UNTIL',
] as const;

function parseRequiredIso(name: (typeof REQUIRED_TEMPORAL_ENV)[number]): number {
  const value = process.env[name]?.trim();
  if (!value) {
    logger.error(`lu-identity-v3-worker: ${name} is not set -- refusing to start.`);
    process.exit(1);
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    logger.error(`lu-identity-v3-worker: ${name} must be ISO-8601 -- refusing to start.`);
    process.exit(1);
  }
  return parsed;
}

function main(): void {
  if (!process.env.LU_EXECUTION_AUTHORITY_PRIVATE_KEY_PEM) {
    logger.error('lu-identity-v3-worker: LU_EXECUTION_AUTHORITY_PRIVATE_KEY_PEM is not set -- refusing to start.');
    process.exit(1);
  }

  const validFrom = parseRequiredIso('LU_SOURCE_AUTHORITY_VALID_FROM');
  const validUntil = parseRequiredIso('LU_SOURCE_AUTHORITY_VALID_UNTIL');
  if (validFrom >= validUntil) {
    logger.error('lu-identity-v3-worker: temporal authority validity window is empty/inverted -- refusing to start.');
    process.exit(1);
  }
  const revokedAt = process.env.LU_SOURCE_AUTHORITY_REVOKED_AT?.trim();
  if (revokedAt && Number.isNaN(Date.parse(revokedAt))) {
    logger.error('lu-identity-v3-worker: LU_SOURCE_AUTHORITY_REVOKED_AT must be ISO-8601 -- refusing to start.');
    process.exit(1);
  }

  logger.info('lu-identity-v3-worker: Starting LU ExecutionIdentity V3 + temporal-authority provisioning worker...');
  const pollMs = Math.max(1000, Number(process.env.LU_IDENTITY_V3_WORKER_POLL_MS || 5000));
  startLocalizationIdentityProvisioningWorker(pollMs);
  logger.info(`lu-identity-v3-worker: Polling for requests every ${pollMs}ms.`);
}

main();
