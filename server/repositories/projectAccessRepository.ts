import { prisma } from "../db/prisma";

export async function assertProjectMembership(input: {
  projectId: string;
  userId: string;
  organisationId: string;
  role?: "ADMIN" | "CONSULTANT" | "AUDITOR" | "BANK";
}): Promise<void> {
  const project = await prisma.project.findUnique({
    where: { id: input.projectId },
    select: {
      id: true,
      organisationId: true,
      status: true,
    },
  });

  if (!project) {
    throw new Error("Project not found");
  }
  if (input.role === "ADMIN") {
    return;
  }

  if (project.organisationId !== input.organisationId) {
    throw new Error("Cross-organisation access denied");
  }
  if (project.status !== "ACTIVE") {
    throw new Error("Project is not active");
  }

  const membership = await prisma.projectMember.findUnique({
    where: {
      projectId_userId: {
        projectId: input.projectId,
        userId: input.userId,
      },
    },
    select: { id: true },
  });

  if (!membership) {
    throw new Error("User is not a member of this project");
  }
}
