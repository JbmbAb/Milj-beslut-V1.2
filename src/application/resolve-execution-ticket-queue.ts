import type { ExecutionTicketQueue } from "../../packages/mps-control-plane/src/ExecutionTicketQueue.js";

export type ResolveTicketQueueOptions = {
  readonly env?: NodeJS.ProcessEnv;
  /** Injected for tests */
  readonly createPrismaQueue?: () => Promise<ExecutionTicketQueue>;
  readonly createFileQueue?: () => ExecutionTicketQueue;
};

/**
 * Feature-flagged ticket queue selection.
 * - LU_MPS_TICKETS=file → file fallback
 * - default prisma → Prisma; on failure → file fallback
 */
export async function resolveExecutionTicketQueue(
  options: ResolveTicketQueueOptions = {},
): Promise<{ queue: ExecutionTicketQueue; backend: "prisma" | "file" }> {
  const env = options.env ?? process.env;
  const mode = (env.LU_MPS_TICKETS ?? "prisma").toLowerCase();

  const createFile =
    options.createFileQueue ??
    (async () => {
      const { createFileTicketQueue } = await import("@miljobeslut/mps-control-plane");
      return createFileTicketQueue();
    });

  if (mode === "file") {
    return { queue: await createFile(), backend: "file" };
  }

  try {
    if (options.createPrismaQueue) {
      return { queue: await options.createPrismaQueue(), backend: "prisma" };
    }
    const { prisma } = await import("../../server/db/prisma.js");
    const { PrismaExecutionTicketQueue } = await import(
      "../infrastructure/PrismaExecutionTicketQueue.js"
    );
    return { queue: new PrismaExecutionTicketQueue(prisma), backend: "prisma" };
  } catch {
    return { queue: await createFile(), backend: "file" };
  }
}
