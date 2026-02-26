import type { AuthUser, PropertyLookupInput } from "./types";

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
  const forbiddenPatterns = [",", ";", "*", "%", " OR ", " AND "];
  if (forbiddenPatterns.some((pattern) => cleaned.toUpperCase().includes(pattern.trim().toUpperCase()))) {
    throw new Error("Bulk or wildcard property lookup is not allowed");
  }
}

export function assertPermission(user: AuthUser, permission: string): void {
  if (!rolePermissions[user.role]?.has(permission)) {
    throw new Error("Role lacks permission");
  }
}
