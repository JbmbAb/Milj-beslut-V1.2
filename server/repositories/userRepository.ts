import { prisma } from '../db/prisma';
import type { AuthUser } from '../security/types';

async function ensureAdminProjectMemberships(input: {
  userId: string;
  organisationId: string;
  role: AuthUser['role'];
}): Promise<void> {
  if (input.role !== 'ADMIN') return;
  if (!prisma.project?.findMany || !prisma.projectMember?.upsert) return;

  const projects = await prisma.project.findMany({
    where: {
      organisationId: input.organisationId,
      status: 'ACTIVE',
    },
    select: {
      id: true,
    },
    take: 500,
  });

  if (projects.length === 0) return;

  await prisma.$transaction(
    projects.map((project) =>
      prisma.projectMember.upsert({
        where: {
          projectId_userId: {
            projectId: project.id,
            userId: input.userId,
          },
        },
        create: {
          projectId: project.id,
          userId: input.userId,
          accessRole: 'OWNER',
        },
        update: {
          accessRole: 'OWNER',
        },
      }),
    ),
  );
}

export async function findAuthUserByBankId(bankidId: string): Promise<AuthUser | null> {
  const user = await prisma.user.findUnique({
    where: { bankidId },
    select: {
      id: true,
      bankidId: true,
      role: true,
      organisationId: true,
    },
  });

  if (!user) {
    return null;
  }

  return {
    id: user.id,
    bankidId: user.bankidId,
    role: user.role as AuthUser['role'],
    organisationId: user.organisationId,
  };
}

export async function ensureAdminConsoleUser(username: string): Promise<AuthUser> {
  const safeUser = (username || 'admin').trim().toLowerCase() || 'admin';
  const orgNumber = process.env.ADMIN_ORG_NUMBER || '999999-0001';
  const orgName = process.env.ADMIN_ORG_NAME || 'Miljöbeslut Admin';
  const bankidId = `admin:${safeUser}`;

  const organisation = await prisma.organisation.upsert({
    where: { orgNumber },
    create: {
      name: orgName,
      orgNumber,
      role: 'AUTHORITY',
    },
    update: {
      name: orgName,
    },
    select: { id: true },
  });

  const user = await prisma.user.upsert({
    where: { bankidId },
    create: {
      bankidId,
      organisationId: organisation.id,
      role: 'ADMIN',
    },
    update: {
      organisationId: organisation.id,
      role: 'ADMIN',
    },
    select: {
      id: true,
      bankidId: true,
      role: true,
      organisationId: true,
    },
  });

  await ensureAdminProjectMemberships({
    userId: user.id,
    organisationId: user.organisationId,
    role: user.role as AuthUser['role'],
  });

  return {
    id: user.id,
    bankidId: user.bankidId,
    role: user.role as AuthUser['role'],
    organisationId: user.organisationId,
  };
}

export async function ensureMockAuthUser(bankidId: string): Promise<AuthUser> {
  const orgNumber = process.env.BANKID_MOCK_ORG_NUMBER || 'MOCK-0001';
  const orgName = process.env.BANKID_MOCK_ORG_NAME || 'Mock BankID Organisation';
  const role = (process.env.BANKID_MOCK_USER_ROLE || 'ADMIN').trim().toUpperCase() as AuthUser['role'];

  const organisation = await prisma.organisation.upsert({
    where: { orgNumber },
    create: {
      name: orgName,
      orgNumber,
      role: 'CLIENT',
    },
    update: {
      name: orgName,
    },
    select: { id: true },
  });

  const user = await prisma.user.upsert({
    where: { bankidId },
    create: {
      bankidId,
      organisationId: organisation.id,
      role,
    },
    update: {
      organisationId: organisation.id,
      role,
    },
    select: {
      id: true,
      bankidId: true,
      role: true,
      organisationId: true,
    },
  });

  await ensureAdminProjectMemberships({
    userId: user.id,
    organisationId: user.organisationId,
    role: user.role as AuthUser['role'],
  });

  return {
    id: user.id,
    bankidId: user.bankidId,
    role: user.role as AuthUser['role'],
    organisationId: user.organisationId,
  };
}
