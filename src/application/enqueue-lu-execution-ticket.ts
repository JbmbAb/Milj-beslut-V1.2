import { resolveExecutionTicketQueue } from "./resolve-execution-ticket-queue.js";

/**
 * Persist admitted LU manifests to durable ExecutionTicket queue.
 * Default: Prisma (restart-safe). Fallback: file queue when LU_MPS_TICKETS=file
 * or when Prisma is unavailable.
 */
export async function enqueueAdmittedLuTicket(manifestId: string): Promise<string | null> {
  if (process.env.NODE_ENV === "test" || process.env.VITEST) {
    return null;
  }

  const ticketId = `ticket-${manifestId}`;
  const manifestRef = {
    artifact_id: manifestId,
    artifact_type: "execution_manifest" as const,
  };

  try {
    const { createPendingTicket, AdmittedTicketWorker } = await import(
      "@miljobeslut/mps-control-plane"
    );
    const ticket = createPendingTicket(ticketId, manifestRef);
    const { queue } = await resolveExecutionTicketQueue();

    await queue.enqueue(ticket);

    const worker = new AdmittedTicketWorker(
      queue,
      { isAdmitted: async () => true },
      {
        runAdmittedManifest: async () => {
          /* synchronous kernel path already ran */
        },
      },
      "lu-report-worker",
    );
    await worker.processNext();
    return ticket.ticket_id;
  } catch {
    return null;
  }
}
