/**
 * PRODUCT-LU-EXECUTION-IDENTITY-V3-PROVISIONING-01 Phase B.
 *
 * Standalone-process worker service. Only server/workers/lu-execution-identity-v3-worker.ts (a
 * separate process from the web server) should ever call
 * `startLocalizationIdentityProvisioningWorker` -- the web server imports the queue module
 * (enqueue/status read) but must never import this file, since
 * executeLocalizationIdentityProvisioning (via luExecutionIdentityV3Provisioning.ts) is the one
 * place that reads LU_EXECUTION_AUTHORITY_PRIVATE_KEY_PEM.
 */
import { logger } from '../logger';
import {
  leaseOnePendingLocalizationIdentityProvisioningRequest,
  markLocalizationIdentityProvisioningCompleted,
  markLocalizationIdentityProvisioningFailed,
} from '../modules/localization/localizationIdentityProvisioningQueue';
import { executeLocalizationIdentityProvisioning } from '../modules/localization/luExecutionIdentityV3Provisioning';

let activeRun = false;

/** Leases and executes at most one request. Returns 1 if a request was processed, 0 if the queue was empty. */
export async function processLocalizationIdentityProvisioningRequestsOnce(): Promise<number> {
  if (activeRun) return 0;
  activeRun = true;
  try {
    const request = await leaseOnePendingLocalizationIdentityProvisioningRequest();
    if (!request) return 0;

    logger.info(`lu-identity-v3-worker: leased request ${request.id} for project ${request.projectId} geometry ${request.geometryArtifactId}`);
    const outcome = await executeLocalizationIdentityProvisioning({
      projectId: request.projectId,
      geometryArtifactId: request.geometryArtifactId,
      requestedByUserId: request.requestedByUserId,
    });

    if (outcome.ok) {
      await markLocalizationIdentityProvisioningCompleted(request.id, outcome.executionIdentityArtifactId);
      logger.info(
        `lu-identity-v3-worker: request ${request.id} COMPLETED (identity=${outcome.executionIdentityArtifactId}, reused=${outcome.reused})`,
      );
    } else {
      await markLocalizationIdentityProvisioningFailed(request.id, outcome.failureCode, outcome.failureDetail);
      logger.warn(`lu-identity-v3-worker: request ${request.id} FAILED (${outcome.failureCode}): ${outcome.failureDetail}`);
    }
    return 1;
  } finally {
    activeRun = false;
  }
}

export function startLocalizationIdentityProvisioningWorker(pollMs: number): NodeJS.Timeout {
  return setInterval(() => {
    void processLocalizationIdentityProvisioningRequestsOnce().catch((error) => {
      logger.error(`lu-identity-v3-worker: unexpected error: ${error instanceof Error ? error.message : String(error)}`);
    });
  }, pollMs);
}
