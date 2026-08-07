/**
 * Package 22.3 — FailureCodeRegistry
 * Answers only: "What does this failure_code mean?"
 * MUST NOT create FailureArtifacts. MUST NOT modify Package 21 identity.
 * @see ADR-MPS-022 §5 / F22-6
 */

import type { FailureCodeDefinition } from "./FailureCodeTypes.js";
import {
  FAILURE_CODE_DEFINITIONS_V1,
  FAILURE_CODE_REGISTRY_VERSION,
} from "./registry/failure-codes.js";

export class FailureCodeRegistryError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FailureCodeRegistryError";
  }
}

export interface FailureCodeRegistry {
  readonly registry_version: string;
  resolve(code: string): FailureCodeDefinition;
  exists(code: string): boolean;
  list(): readonly FailureCodeDefinition[];
}

/**
 * Build an immutable registry from definitions.
 * Duplicate codes (same code string twice) are rejected at construction (F22-6.3).
 */
export function createFailureCodeRegistry(
  definitions: readonly FailureCodeDefinition[],
  registry_version: string = FAILURE_CODE_REGISTRY_VERSION,
): FailureCodeRegistry {
  const byCode = new Map<string, FailureCodeDefinition>();

  for (const def of definitions) {
    if (!def.code || typeof def.code !== "string") {
      throw new FailureCodeRegistryError(
        "MPS-DIAG-FAILURE-CODE-INVALID",
        "FailureCodeDefinition.code must be a non-empty string",
      );
    }
    if (byCode.has(def.code)) {
      throw new FailureCodeRegistryError(
        "MPS-DIAG-FAILURE-CODE-DUPLICATE",
        `Duplicate failure_code definition forbidden (F22-6): ${def.code}`,
      );
    }
    byCode.set(def.code, Object.freeze({ ...def }));
  }

  const frozenList = Object.freeze(
    [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code)),
  ) as readonly FailureCodeDefinition[];

  return Object.freeze({
    registry_version,
    resolve(code: string): FailureCodeDefinition {
      const found = byCode.get(code);
      if (!found) {
        throw new FailureCodeRegistryError(
          "MPS-DIAG-FAILURE-CODE-UNKNOWN",
          `Unknown failure_code: ${code}`,
        );
      }
      return found;
    },
    exists(code: string): boolean {
      return byCode.has(code);
    },
    list(): readonly FailureCodeDefinition[] {
      return frozenList;
    },
  });
}

/** Default governed registry (registry_version "1"). */
export const defaultFailureCodeRegistry: FailureCodeRegistry = createFailureCodeRegistry(
  FAILURE_CODE_DEFINITIONS_V1,
  FAILURE_CODE_REGISTRY_VERSION,
);

export { FAILURE_CODE_DEFINITIONS_V1, FAILURE_CODE_REGISTRY_VERSION };
