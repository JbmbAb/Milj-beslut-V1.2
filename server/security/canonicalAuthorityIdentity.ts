import type { AuthUser } from "./types";
import { prisma } from "../db/prisma";
import { isDisqualifiedBankIdSubject } from "../../packages/mps-compliance/src/artifacts/AdminRoleGrantArtifact";
import {
  createHumanIdentityArtifactFromBankId,
  type HumanIdentityArtifact,
} from "../../packages/mps-governance/src/actors/IdentityArtifacts";

export class CanonicalHumanIdentityRejected extends Error {
  constructor(public readonly reason: string) {
    super(`FAIL_CLOSED: ${reason}`);
    this.name = "CanonicalHumanIdentityRejected";
  }
}

export interface PersistedHumanPrincipal {
  readonly id: string;
  readonly bankidId: string;
}

/**
 * Pure principal-binding step.
 *
 * Authentication proves the presented principal. This function additionally
 * requires that the mutable runtime principal still resolves to the exact same
 * persisted BankID subject before deriving the canonical HumanIdentityArtifact.
 *
 * Role and organisation are deliberately ignored: they are authorization state,
 * not human identity.
 */
export function bindAuthUserToCanonicalHumanIdentity(
  authUser: Pick<AuthUser, "id" | "bankidId">,
  persisted: PersistedHumanPrincipal,
): HumanIdentityArtifact {
  if (persisted.id !== authUser.id) {
    throw new CanonicalHumanIdentityRejected("authenticated user id does not match persisted principal");
  }
  if (persisted.bankidId !== authUser.bankidId) {
    throw new CanonicalHumanIdentityRejected("authenticated BankID subject does not match persisted principal");
  }
  if (isDisqualifiedBankIdSubject(persisted.bankidId)) {
    throw new CanonicalHumanIdentityRejected("synthetic admin/mock identity cannot become canonical human authority identity");
  }

  return createHumanIdentityArtifactFromBankId(persisted.bankidId);
}

/**
 * Production composition bridge from requireAuth's principal to the frozen
 * ADR-24-21 HumanIdentityArtifact.
 *
 * This does NOT grant authority and does NOT persist anything. It only closes
 * principal -> canonical identity deterministically; grants remain separate.
 */
export async function resolveCanonicalHumanIdentityForAuthUser(
  authUser: Pick<AuthUser, "id" | "bankidId">,
): Promise<HumanIdentityArtifact> {
  const persisted = await prisma.user.findUnique({
    where: { id: authUser.id },
    select: { id: true, bankidId: true },
  });
  if (!persisted) {
    throw new CanonicalHumanIdentityRejected("authenticated principal no longer exists");
  }
  return bindAuthUserToCanonicalHumanIdentity(authUser, persisted);
}
