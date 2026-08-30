/**
 * LU-PROJECTION-RECONCILIATION-AND-TOTAL-ORDER-V1 Phase B.
 *
 * Standalone-process worker service. Only server/workers/lu-geometry-supersession-worker.ts (a
 * separate process from the web server) should ever call
 * `startGeometrySupersessionProvisioningWorker` -- the web server imports the queue module
 * (enqueue/status read) but must never import this file, since
 * executeGeometrySupersessionProvisioning (via luGeometrySupersessionProvisioning.ts) is the one
 * place that reads LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_PRIVATE_KEY_PEM.
 */
import { logger } from '../logger';
import {
  leaseOnePendingLocalizationGeometrySupersessionRequest,
  markLocalizationGeometrySupersessionCompleted,
  markLocalizationGeometrySupersessionFailed,
  markLocalizationGeometrySupersessionSuperseded,
} from '../modules/localization/localizationGeometrySupersessionQueue';
import { executeGeometrySupersessionProvisioning } from '../modules/localization/luGeometrySupersessionProvisioning';

let activeRun = false;

/** Leases and executes at most one request. Returns 1 if a request was processed, 0 if the queue was empty. */
export async function processGeometrySupersessionProvisioningRequestsOnce(): Promise<number> {
  if (activeRun) return 0;
  activeRun = true;
  try {
    const request = await leaseOnePendingLocalizationGeometrySupersessionRequest();
    if (!request) return 0;
    const leaseToken = request.leaseToken;
    if (!leaseToken) {
      logger.error(
        `lu-geometry-supersession-worker: request ${request.id} was leased without a lease token -- refusing terminal mutation.`,
      );
      return 1;
    }

    logger.info(
      `lu-geometry-supersession-worker: leased request ${request.id} for project ${request.projectId} (${request.predecessorGeometryArtifactId} -> ${request.successorGeometryArtifactId})`,
    );
    const outcome = await executeGeometrySupersessionProvisioning({
      requestId: request.id,
      requestCreatedAt: request.createdAt,
      projectId: request.projectId,
      predecessorGeometryArtifactId: request.predecessorGeometryArtifactId,
      successorGeometryArtifactId: request.successorGeometryArtifactId,
      requestedByUserId: request.requestedByUserId,
    });

    if (outcome.ok === true) {
      const terminal = await markLocalizationGeometrySupersessionCompleted(
        request.id,
        leaseToken,
        outcome.supersessionArtifactId,
      );
      if (terminal.ok === true) {
        logger.info(
          `lu-geometry-supersession-worker: request ${request.id} COMPLETED (edge=${outcome.supersessionArtifactId}, reused=${outcome.reused})`,
        );
      } else if (terminal.ok === false) {
        logger.warn(
          `lu-geometry-supersession-worker: request ${request.id} completion ignored (${terminal.reason})`,
        );
      }
    } else if (outcome.ok === false && outcome.superseded === true) {
      const terminal = await markLocalizationGeometrySupersessionSuperseded(
        request.id,
        leaseToken,
        outcome.detail,
      );
      if (terminal.ok === true) {
        logger.info(`lu-geometry-supersession-worker: request ${request.id} SUPERSEDED: ${outcome.detail}`);
      } else if (terminal.ok === false) {
        logger.warn(
          `lu-geometry-supersession-worker: request ${request.id} supersede ignored (${terminal.reason})`,
        );
      }
    } else if (outcome.ok === false) {
      const terminal = await markLocalizationGeometrySupersessionFailed(
        request.id,
        leaseToken,
        outcome.failureCode,
        outcome.failureDetail,
      );
      if (terminal.ok === true) {
        logger.warn(
          `lu-geometry-supersession-worker: request ${request.id} FAILED (${outcome.failureCode}): ${outcome.failureDetail}`,
        );
      } else if (terminal.ok === false) {
        logger.warn(
          `lu-geometry-supersession-worker: request ${request.id} failure ignored (${terminal.reason})`,
        );
      }
    }
    return 1;
  } finally {
    activeRun = false;
  }
}

export function startGeometrySupersessionProvisioningWorker(pollMs: number): NodeJS.Timeout {
  return setInterval(() => {
    void processGeometrySupersessionProvisioningRequestsOnce().catch((error) => {
      logger.error(
        `lu-geometry-supersession-worker: unexpected error: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }, pollMs);
}
