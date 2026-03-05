import { prisma } from "../db/prisma";
import type { ProjectPlan } from "../../types";

const db = prisma as any;

export async function getStoredProjectPlan(projectId: string): Promise<Partial<ProjectPlan> | null> {
  const row = await db.projectPlanState.findUnique({
    where: { projectId },
    select: { plan: true },
  });
  if (!row?.plan || typeof row.plan !== "object") {
    return null;
  }
  return row.plan as Partial<ProjectPlan>;
}

export async function upsertStoredProjectPlan(input: {
  projectId: string;
  schemaVersion: number;
  plan: ProjectPlan;
}) {
  return db.projectPlanState.upsert({
    where: { projectId: input.projectId },
    create: {
      projectId: input.projectId,
      schemaVersion: input.schemaVersion,
      plan: input.plan,
    },
    update: {
      schemaVersion: input.schemaVersion,
      plan: input.plan,
    },
  });
}
