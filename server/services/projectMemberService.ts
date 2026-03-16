/**
 * projectMemberService.ts
 *
 * CRUD-operationer för projektmedlemmar.
 * Ger fullständig hantering av roller i ett projekt:
 *   - Lista medlemmar
 *   - Lägg till / bjud in en befintlig användare
 *   - Ta bort / ändra roll
 */

import { prisma } from '../db/prisma';
import type { ProjectAccessRole, ProjectMemberRecord } from '../../types';

const VALID_ROLES: ProjectAccessRole[] = ['OWNER', 'CONTRIBUTOR', 'REVIEWER', 'AUDITOR'];

export function isValidRole(value: unknown): value is ProjectAccessRole {
  return VALID_ROLES.includes(value as ProjectAccessRole);
}

/** Lista alla medlemmar i ett projekt */
export async function listProjectMembers(projectId: string): Promise<ProjectMemberRecord[]> {
  const rows = await prisma.projectMember.findMany({
    where: { projectId },
    include: {
      user: {
        select: {
          id: true,
          bankidId: true,
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  return rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    bankidId: r.user.bankidId,
    accessRole: r.accessRole as ProjectAccessRole,
    createdAt: r.createdAt.toISOString(),
  }));
}

/** Lägg till en användare som projektmedlem (eller uppdatera befintlig roll) */
export async function upsertProjectMember(params: {
  projectId: string;
  targetBankidId: string;
  role: ProjectAccessRole;
  actingUserId: string;
}): Promise<ProjectMemberRecord> {
  // Verifiera att aktuellt projekt finns
  const project = await prisma.project.findUnique({
    where: { id: params.projectId },
    select: { id: true, organisationId: true, status: true },
  });
  if (!project) throw new Error('Project not found');
  if (project.status !== 'ACTIVE') throw new Error('Project is not active');

  // Hitta målanvändaren via bankidId
  const targetUser = await prisma.user.findUnique({
    where: { bankidId: params.targetBankidId },
    select: { id: true, bankidId: true, organisationId: true },
  });
  if (!targetUser) throw new Error(`User '${params.targetBankidId}' not found`);

  // Organisationscheck — ska vara samma organisation
  if (targetUser.organisationId !== project.organisationId) {
    throw new Error('Cross-organisation member assignment denied');
  }

  const member = await prisma.projectMember.upsert({
    where: {
      projectId_userId: {
        projectId: params.projectId,
        userId: targetUser.id,
      },
    },
    create: {
      projectId: params.projectId,
      userId: targetUser.id,
      accessRole: params.role,
    },
    update: {
      accessRole: params.role,
    },
    include: {
      user: { select: { id: true, bankidId: true } },
    },
  });

  return {
    id: member.id,
    userId: member.userId,
    bankidId: member.user.bankidId,
    accessRole: member.accessRole as ProjectAccessRole,
    createdAt: member.createdAt.toISOString(),
  };
}

/** Ta bort en projektmedlem */
export async function removeProjectMember(params: {
  projectId: string;
  memberId: string;
  actingUserId: string;
}): Promise<void> {
  const member = await prisma.projectMember.findUnique({
    where: { id: params.memberId },
    select: { id: true, projectId: true, userId: true },
  });
  if (!member) throw new Error('Member not found');
  if (member.projectId !== params.projectId) throw new Error('Member does not belong to this project');

  // Hindra OWNER från att ta bort sig själv om det inte finns någon annan OWNER
  const ownerCount = await prisma.projectMember.count({
    where: { projectId: params.projectId, accessRole: 'OWNER' },
  });

  const isRemovingSelf = member.userId === params.actingUserId;
  const memberIsOwner = await prisma.projectMember.findFirst({
    where: { id: params.memberId, accessRole: 'OWNER' },
    select: { id: true },
  });

  if (memberIsOwner && ownerCount <= 1) {
    throw new Error('Cannot remove the last OWNER of a project');
  }

  if (isRemovingSelf) {
    throw new Error('Cannot remove yourself from the project via this endpoint');
  }

  await prisma.projectMember.delete({ where: { id: params.memberId } });
}
