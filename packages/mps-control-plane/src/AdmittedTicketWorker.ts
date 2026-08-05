import type { FrozenExecutionTicket } from "../../mps-runtime/src/contracts/freeze/FrozenIdentities.js";
import type { ExecutionTicketQueue } from "./ExecutionTicketQueue.js";

/**
 * Worker that only runs tickets whose manifests were admitted (Fas 4).
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
  private readonly admission: AdmissionGate;
  private readonly runner: AdmittedTicketRunner;
  private readonly worker_id: string;

  constructor(
    queue: ExecutionTicketQueue,
    admission: AdmissionGate,
    runner: AdmittedTicketRunner,
    worker_id: string,
  ) {
    this.queue = queue;
    this.admission = admission;
    this.runner = runner;
    this.worker_id = worker_id;
  }

  /**
   * Reserve one ticket; skip/fail if not admitted; otherwise run via kernel.
   */
  async processNext(): Promise<FrozenExecutionTicket | null> {
    const ticket = this.queue.reserve(this.worker_id);
    if (!ticket) return null;

    const admitted = await this.admission.isAdmitted(ticket.manifest_ref.artifact_id);
    if (!admitted) {
      this.queue.fail(ticket.ticket_id, "manifest_not_admitted");
      return this.queue.get(ticket.ticket_id) ?? ticket;
    }

    try {
      await this.runner.runAdmittedManifest(ticket.manifest_ref);
      this.queue.complete(ticket.ticket_id);
    } catch (err) {
      const reason = err instanceof Error ? err.message : "worker_error";
      this.queue.fail(ticket.ticket_id, reason);
    }

    return this.queue.get(ticket.ticket_id) ?? ticket;
  }
}
