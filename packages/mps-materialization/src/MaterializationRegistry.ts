/**
 * Materialization Registry — binds versions for controlled migration.
 *
 * materialization_version ↔ rule_version ↔ canonical_version ↔ artifact type
 *
 * Future upgrades register a new entry; they MUST NOT silently reinterpret old bindings.
 */

import { DECISION_GOVERNANCE_CANONICAL_VERSION } from "../../mps-decision-governance/src/index.js";
import {
  MATERIALIZATION_VERSION,
  MaterializationContractError,
  RULE_VERSION,
} from "./MaterializationContract.js";

export type MaterializationArtifactType = "decision_impact_v1";

export type MaterializationRegistration = {
  readonly artifact_type: MaterializationArtifactType;
  readonly canonicalizer: string;
  readonly rules: string;
  readonly materializer: string;
  readonly introduced_version: string;
};

export const DECISION_IMPACT_V1: MaterializationRegistration = Object.freeze({
  artifact_type: "decision_impact_v1",
  canonicalizer: DECISION_GOVERNANCE_CANONICAL_VERSION,
  rules: RULE_VERSION,
  materializer: MATERIALIZATION_VERSION,
  introduced_version: "mat-registry-1",
});

export interface MaterializationRegistry {
  resolve(artifact_type: MaterializationArtifactType): MaterializationRegistration;
  exists(artifact_type: MaterializationArtifactType): boolean;
  list(): readonly MaterializationRegistration[];
}

export function createMaterializationRegistry(
  registrations: readonly MaterializationRegistration[] = [DECISION_IMPACT_V1],
): MaterializationRegistry {
  const byType = new Map<MaterializationArtifactType, MaterializationRegistration>();
  for (const reg of registrations) {
    if (byType.has(reg.artifact_type)) {
      throw new MaterializationContractError(
        "MATERIALIZATION_REGISTRY_DUPLICATE",
        `Duplicate registration for ${reg.artifact_type}`,
      );
    }
    byType.set(reg.artifact_type, Object.freeze({ ...reg }));
  }

  return Object.freeze({
    resolve(artifact_type: MaterializationArtifactType): MaterializationRegistration {
      const found = byType.get(artifact_type);
      if (!found) {
        throw new MaterializationContractError(
          "MATERIALIZATION_REGISTRY_UNKNOWN",
          `Unknown artifact_type: ${artifact_type}`,
        );
      }
      return found;
    },
    exists(artifact_type: MaterializationArtifactType): boolean {
      return byType.has(artifact_type);
    },
    list(): readonly MaterializationRegistration[] {
      return Object.freeze([...byType.values()]);
    },
  });
}

export const defaultMaterializationRegistry = createMaterializationRegistry();
