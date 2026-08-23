/**
 * PRODUCT-LU-VIEWER-CAPABILITY-PROVISIONING-01 Phase B.
 *
 * Standalone-process worker service. Only server/workers/lu-viewer-capability-worker.ts (a
 * separate process from the web server) should ever call
 * `startViewerCapabilityProvisioningWorker` -- the web server imports the queue module
 * (enqueue/status read) but must never import this file, since
 * executeViewerCapabilityProvisioning (via luViewerCapabilityProvisioning.ts) is the one place
 * that reads VIEWER_CAPABILITY_ISSUER_PRIVATE_KEY_PEM.
 */
import { logger } from '../logger';
import {
  leaseOnePendingViewerCapabilityProvisioningRequest,
  markViewerCapabilityProvisioningCompleted,
  markViewerCapabilityProvisioningFailed,
  markViewerCapabilityProvisioningSuperseded,
} from '../modules/localization/viewerCapabilityProvisioningQueue';
import { executeViewerCapabilityProvisioning } from '../modules/localization/luViewerCapabilityProvisioning';

let activeRun = false;

/** Leases and executes at most one request. Returns 1 if a request was processed, 0 if the queue was empty. */
export async function processViewerCapabilityProvisioningRequestsOnce(): Promise<number> {
  if (activeRun) return 0;
  activeRun = true;
  try {
    const request = await leaseOnePendingViewerCapabilityProvisioningRequest();
    if (!request) return 0;

    logger.info(
      `lu-viewer-capability-worker: leased request ${request.id} for project ${request.projectId} binding ${request.contextBindingArtifactId}`,
    );
    const outcome = await executeViewerCapabilityProvisioning({
      projectId: request.projectId,
      contextBindingArtifactId: request.contextBindingArtifactId,
      releaseArtifactId: request.releaseArtifactId,
      viewerIdentityArtifactId: request.viewerIdentityArtifactId,
      requestedByUserId: request.requestedByUserId,
    });

    if (outcome.ok) {
      await markViewerCapabilityProvisioningCompleted(request.id, outcome.capabilityArtifactId);
      logger.info(
        `lu-viewer-capability-worker: request ${request.id} COMPLETED (capability=${outcome.capabilityArtifactId}, reused=${outcome.reused})`,
      );
    } else if (outcome.superseded) {
      await markViewerCapabilityProvisioningSuperseded(request.id, outcome.detail);
      logger.info(`lu-viewer-capability-worker: request ${request.id} SUPERSEDED: ${outcome.detail}`);
    } else {
      await markViewerCapabilityProvisioningFailed(request.id, outcome.failureCode, outcome.failureDetail);
      logger.warn(`lu-viewer-capability-worker: request ${request.id} FAILED (${outcome.failureCode}): ${outcome.failureDetail}`);
    }
    return 1;
  } finally {
    activeRun = false;
  }
}

export function startViewerCapabilityProvisioningWorker(pollMs: number): NodeJS.Timeout {
  return setInterval(() => {
    void processViewerCapabilityProvisioningRequestsOnce().catch((error) => {
      logger.error(`lu-viewer-capability-worker: unexpected error: ${error instanceof Error ? error.message : String(error)}`);
    });
  }, pollMs);
}
