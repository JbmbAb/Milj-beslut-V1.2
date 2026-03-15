import type { AuthUser, PropertyLookupInput } from "./types";
import { assertProjectMembership } from "../repositories/projectAccessRepository";

const rolePermissions: Record<AuthUser["role"], ReadonlySet<string>> = {
  ADMIN: new Set(["PROPERTY_LOOKUP", "AUDIT_EXPORT"]),
  CONSULTANT: new Set(["PROPERTY_LOOKUP"]),
  AUDITOR: new Set(["PROPERTY_LOOKUP", "AUDIT_EXPORT"]),
  BANK: new Set([]),
};

export function validatePropertyLookupInput(input: PropertyLookupInput): void {
  if (!input.projectId || !input.propertyDesignation || !input.purpose) {
    throw new Error("projectId, propertyDesignation and purpose are required");
  }

  const cleaned = input.propertyDesignation.trim();
  const hasForbiddenToken = /[,;*%]/.test(cleaned);
  const hasBooleanOperator = /\b(?:OR|AND)\b/i.test(cleaned);
  if (hasForbiddenToken || hasBooleanOperator) {
    throw new Error("Bulk or wildcard property lookup is not allowed");
  }
}

/**
 * Verifies that a user has a specific permission based on their role.
 * NOTE: This is role-based, not resource-level. Use assertProjectAccess for resource checks.
 */
export function assertPermission(user: AuthUser, permission: string): void {
  if (!rolePermissions[user.role]?.has(permission)) {
    throw new Error("Insufficient role permissions");
  }
}

/**
 * CRITICAL: Verifies that user has access to a specific project.
 * This must be checked for ALL project-scoped operations.
 * ADMINs do NOT bypass this check - they must be project members.
 */
export async function assertProjectAccess(
  user: AuthUser,
  projectId: string,
  organizationId: string
): Promise<void> {
  // Even admins must have explicit project membership
  await assertProjectMembership({
    projectId,
    userId: user.id,
    organisationId: organizationId,
  });
}
