import { prisma } from "../db/prisma";
import type { AuthUser } from "../security/types";

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
    role: user.role as AuthUser["role"],
    organisationId: user.organisationId,
  };
}

export async function ensureAdminConsoleUser(username: string): Promise<AuthUser> {
  const safeUser = (username || "admin").trim().toLowerCase() || "admin";
  const orgNumber = process.env.ADMIN_ORG_NUMBER || "999999-0001";
  const orgName = process.env.ADMIN_ORG_NAME || "Miljobeslut Admin";
  const bankidId = `admin:${safeUser}`;

  const organisation = await prisma.organisation.upsert({
    where: { orgNumber },
    create: {
      name: orgName,
      orgNumber,
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
      role: "ADMIN",
    },
    update: {
      organisationId: organisation.id,
      role: "ADMIN",
    },
    select: {
      id: true,
      bankidId: true,
      role: true,
      organisationId: true,
    },
  });

  return {
    id: user.id,
    bankidId: user.bankidId,
    role: user.role as AuthUser["role"],
    organisationId: user.organisationId,
  };
}
