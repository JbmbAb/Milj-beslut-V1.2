import { prisma } from '../db/prisma';

export const PROJECT_ACCESS_DENIED = 'PROJECT_ACCESS_DENIED' as const;

/**
 * W-CATCH2 #14 (OD-R2): the access check DECIDED "no access" -- the project is unknown, belongs to
 * another organisation, is not active, or the user is not a member. Same messages as before (callers
 * and the generic error mapping that read them are unchanged); the stable `code` lets a caller tell a
 * denial from a failure to READ the access facts (a database that cannot answer), which must never be
 * answered "not authorized".
 */
export class ProjectAccessDeniedError extends Error {
  readonly code = PROJECT_ACCESS_DENIED;

  constructor(message: string) {
    super(message);
    this.name = 'ProjectAccessDeniedError';
  }
}

export async function assertProjectMembership(input: {
  projectId: string;
  userId: string;
  organisationId: string;
  role?: 'ADMIN' | 'CONSULTANT' | 'AUDITOR' | 'BANK';
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
    throw new ProjectAccessDeniedError('Project not found');
  }

  // SECURITY FIX: ADMINs do NOT bypass membership checks
  // All users must have explicit project membership
  if (project.organisationId !== input.organisationId) {
    throw new ProjectAccessDeniedError('Cross-organisation access denied');
  }
  if (project.status !== 'ACTIVE') {
    throw new ProjectAccessDeniedError('Project is not active');
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
    throw new ProjectAccessDeniedError('User is not a member of this project');
  }
}
