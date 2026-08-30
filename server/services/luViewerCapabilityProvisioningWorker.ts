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
    const leaseToken = request.leaseToken;
    if (!leaseToken) {
      logger.error(
        `lu-viewer-capability-worker: request ${request.id} was leased without a lease token -- refusing terminal mutation.`,
      );
      return 1;
    }

    logger.info(
      `lu-viewer-capability-worker: leased request ${request.id} for project ${request.projectId} binding ${request.contextBindingArtifactId}`,
    );

    // PROJECT-CONTEXT-BINDING-V2-PRODUCER-ADOPTION-01 Phase A.1: the validity window must be
    // pinned on the request itself -- the worker never derives a fallback. A row predating this
    // field (nullable only for that reason) cannot be safely processed; fail it explicitly so it
    // surfaces for an explicit retry (which enqueues a fresh row with a real pinned window),
    // rather than silently inventing a window here.
    if (!request.capabilityValidFrom || !request.capabilityValidUntil) {
      const terminal = await markViewerCapabilityProvisioningFailed(
        request.id,
        leaseToken,
        'MISSING_PINNED_VALIDITY_WINDOW',
        'request predates the explicit capabilityValidFrom/capabilityValidUntil contract -- retry to enqueue a fresh request with a pinned window',
      );
      logger.warn(
        terminal.ok === true
          ? `lu-viewer-capability-worker: request ${request.id} FAILED (MISSING_PINNED_VALIDITY_WINDOW)`
          : `lu-viewer-capability-worker: request ${request.id} validity-window failure ignored (${terminal.reason})`,
      );
      return 1;
    }

    const outcome = await executeViewerCapabilityProvisioning({
      projectId: request.projectId,
      contextBindingArtifactId: request.contextBindingArtifactId,
      releaseArtifactId: request.releaseArtifactId,
      viewerIdentityArtifactId: request.viewerIdentityArtifactId,
      requestedByUserId: request.requestedByUserId,
      capabilityValidFrom: request.capabilityValidFrom,
      capabilityValidUntil: request.capabilityValidUntil,
    });

    if (outcome.ok === true) {
      const terminal = await markViewerCapabilityProvisioningCompleted(
        request.id,
        leaseToken,
        outcome.capabilityArtifactId,
      );
      if (terminal.ok === true) {
        logger.info(
          `lu-viewer-capability-worker: request ${request.id} COMPLETED (capability=${outcome.capabilityArtifactId}, reused=${outcome.reused})`,
        );
      } else if (terminal.ok === false) {
        logger.warn(
          `lu-viewer-capability-worker: request ${request.id} completion ignored (${terminal.reason})`,
        );
      }
    } else if (outcome.ok === false && outcome.superseded === true) {
      const terminal = await markViewerCapabilityProvisioningSuperseded(
        request.id,
        leaseToken,
        outcome.detail,
      );
      if (terminal.ok === true) {
        logger.info(`lu-viewer-capability-worker: request ${request.id} SUPERSEDED: ${outcome.detail}`);
      } else if (terminal.ok === false) {
        logger.warn(
          `lu-viewer-capability-worker: request ${request.id} supersede ignored (${terminal.reason})`,
        );
      }
    } else if (outcome.ok === false) {
      const terminal = await markViewerCapabilityProvisioningFailed(
        request.id,
        leaseToken,
        outcome.failureCode,
        outcome.failureDetail,
      );
      if (terminal.ok === true) {
        logger.warn(
          `lu-viewer-capability-worker: request ${request.id} FAILED (${outcome.failureCode}): ${outcome.failureDetail}`,
        );
      } else if (terminal.ok === false) {
        logger.warn(
          `lu-viewer-capability-worker: request ${request.id} failure ignored (${terminal.reason})`,
        );
      }
    }
    return 1;
  } finally {
    activeRun = false;
  }
}

export function startViewerCapabilityProvisioningWorker(pollMs: number): NodeJS.Timeout {
  return setInterval(() => {
    void processViewerCapabilityProvisioningRequestsOnce().catch((error) => {
      logger.error(
        `lu-viewer-capability-worker: unexpected error: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }, pollMs);
}
