import { resolveExecutionTicketQueue } from "./resolve-execution-ticket-queue.js";

/**
 * Persist admitted LU manifests to durable Execution Infrastructure (2.1).
 * Default: Prisma queue + ExecutionInfrastructure. Fallback: file.
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
    const { createExecutionInfrastructure, AdmittedTicketWorker } = await import(
      "@miljobeslut/mps-control-plane"
    );
    const { queue } = await resolveExecutionTicketQueue();
    const infra = createExecutionInfrastructure(queue);

    await infra.recover();
    await infra.enqueueIdempotent(`lu-admit:${manifestId}`, ticketId, manifestRef);

    const worker = new AdmittedTicketWorker(
      infra,
      { isAdmitted: async () => true },
      {
        runAdmittedManifest: async () => {
          /* synchronous kernel path already ran */
        },
      },
      "lu-report-worker",
    );
    await worker.processNext();
    return ticketId;
  } catch {
    return null;
  }
}
