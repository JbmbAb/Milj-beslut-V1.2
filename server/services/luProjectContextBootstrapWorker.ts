/**
 * PRODUCT-LU-PROJECT-CONTEXT-BOOTSTRAP-01 Phase B.
 *
 * Standalone-process worker service. Only server/workers/lu-project-context-bootstrap-worker.ts
 * (a separate process from the web server) should ever call `startLuProjectContextBootstrapWorker`
 * -- the web server imports the queue module (enqueue/status read) but must never import this
 * file, since executeProjectContextBootstrap (via luProjectContextBootstrap.ts) is the one place
 * that reads PROJECT_CONTEXT_BINDING_ISSUER_PRIVATE_KEY_PEM.
 */
import { logger } from '../logger';
import {
  leaseOnePendingBootstrapRequest,
  markBootstrapRequestCompleted,
  markBootstrapRequestFailed,
} from '../modules/localization/projectContextBootstrapRequestQueue';
import { executeProjectContextBootstrap } from '../modules/localization/luProjectContextBootstrap';

let activeRun = false;

/** Leases and executes at most one request. Returns 1 if a request was processed, 0 if the queue was empty. */
export async function processProjectContextBootstrapRequestsOnce(): Promise<number> {
  if (activeRun) return 0;
  activeRun = true;
  try {
    const request = await leaseOnePendingBootstrapRequest();
    if (!request) return 0;
    const leaseToken = request.leaseToken;
    if (!leaseToken) {
      logger.error(
        `lu-bootstrap-worker: request ${request.id} was leased without a lease token -- refusing terminal mutation.`,
      );
      return 1;
    }

    logger.info(`lu-bootstrap-worker: leased request ${request.id} for project ${request.projectId}`);
    const outcome = await executeProjectContextBootstrap({
      projectId: request.projectId,
      propertyDesignation: request.propertyDesignation,
    });

    if (outcome.ok === true) {
      const terminal = await markBootstrapRequestCompleted(
        request.id,
        leaseToken,
        outcome.contextBindingArtifactId,
      );
      if (terminal.ok === true) {
        logger.info(
          `lu-bootstrap-worker: request ${request.id} COMPLETED (binding=${outcome.contextBindingArtifactId}, reused=${outcome.reused})`,
        );
      } else if (terminal.ok === false) {
        logger.warn(`lu-bootstrap-worker: request ${request.id} completion ignored (${terminal.reason})`);
      }
    } else if (outcome.ok === false) {
      const terminal = await markBootstrapRequestFailed(
        request.id,
        leaseToken,
        outcome.failureCode,
        outcome.failureDetail,
      );
      if (terminal.ok === true) {
        logger.warn(
          `lu-bootstrap-worker: request ${request.id} FAILED (${outcome.failureCode}): ${outcome.failureDetail}`,
        );
      } else if (terminal.ok === false) {
        logger.warn(`lu-bootstrap-worker: request ${request.id} failure ignored (${terminal.reason})`);
      }
    }
    return 1;
  } finally {
    activeRun = false;
  }
}

export function startLuProjectContextBootstrapWorker(pollMs: number): NodeJS.Timeout {
  return setInterval(() => {
    void processProjectContextBootstrapRequestsOnce().catch((error) => {
      logger.error(
        `lu-bootstrap-worker: unexpected error: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }, pollMs);
}
