import type { FrozenExecutionTicket } from "../../mps-runtime/src/contracts/freeze/FrozenIdentities.js";
import type { ExecutionTicketQueue } from "./ExecutionTicketQueue.js";
import type { ExecutionInfrastructure } from "./execution-infrastructure/ExecutionInfrastructure.js";

/**
 * Worker that only runs tickets whose manifests were admitted.
 * Domain/ExecutionKernel is injected — control-plane never imports LU.
 */
export interface AdmittedTicketRunner {
  runAdmittedManifest(manifest_ref: { artifact_id: string }): Promise<void>;
}

export interface AdmissionGate {
  isAdmitted(manifest_id: string): Promise<boolean>;
}

export class AdmittedTicketWorker {
  private readonly queue: ExecutionTicketQueue;
  private readonly infra: ExecutionInfrastructure | null;
  private readonly admission: AdmissionGate;
  private readonly runner: AdmittedTicketRunner;
  private readonly worker_id: string;

  constructor(
    queueOrInfra: ExecutionTicketQueue | ExecutionInfrastructure,
    admission: AdmissionGate,
    runner: AdmittedTicketRunner,
    worker_id: string,
  ) {
    if ("enqueueIdempotent" in queueOrInfra) {
      this.infra = queueOrInfra;
      this.queue = queueOrInfra.queue;
    } else {
      this.infra = null;
      this.queue = queueOrInfra;
    }
    this.admission = admission;
    this.runner = runner;
    this.worker_id = worker_id;
  }

  /**
   * Reserve one ticket; skip/fail if not admitted; otherwise run via kernel.
   */
  async processNext(): Promise<FrozenExecutionTicket | null> {
    const ticket = this.infra
      ? await this.infra.reserve(this.worker_id)
      : await this.queue.reserve(this.worker_id);
    if (!ticket) return null;

    const admitted = await this.admission.isAdmitted(ticket.manifest_ref.artifact_id);
    if (!admitted) {
      if (this.infra) {
        await this.infra.failAndMaybeRetry(ticket.ticket_id, "manifest_not_admitted");
      } else {
        await this.queue.fail(ticket.ticket_id, "manifest_not_admitted");
      }
      return (await this.queue.get(ticket.ticket_id)) ?? ticket;
    }

    try {
      await this.runner.runAdmittedManifest(ticket.manifest_ref);
      if (this.infra) {
        await this.infra.complete(ticket.ticket_id);
      } else {
        await this.queue.complete(ticket.ticket_id);
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : "worker_error";
      if (this.infra) {
        await this.infra.failAndMaybeRetry(ticket.ticket_id, reason);
      } else {
        await this.queue.fail(ticket.ticket_id, reason);
      }
    }

    return (await this.queue.get(ticket.ticket_id)) ?? ticket;
  }
}
