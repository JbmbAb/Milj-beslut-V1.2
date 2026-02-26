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
