import { prisma } from "../db/prisma";
import type { ProjectPlan } from "../../types";

const db = prisma as any;

export async function getStoredProjectPlan(projectId: string, organisationId: string): Promise<Partial<ProjectPlan> | null> {
  const row = await db.projectPlanState.findFirst({
    where: { 
      projectId,
      project: { organisationId }
    },
    select: { plan: true },
  });
  if (!row?.plan || typeof row.plan !== "object") {
    return null;
  }
  return row.plan as Partial<ProjectPlan>;
}

export async function upsertStoredProjectPlan(input: {
  projectId: string;
  organisationId: string;
  schemaVersion: number;
  plan: ProjectPlan;
}) {
  const project = await db.project.findFirst({
    where: { id: input.projectId, organisationId: input.organisationId }
  });
  if (!project) {
    throw new Error("Project not found or access denied");
  }

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
