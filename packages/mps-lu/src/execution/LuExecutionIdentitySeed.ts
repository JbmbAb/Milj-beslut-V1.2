import type { ArtifactReference } from "../../../mps-compliance/src/artifacts/ArtifactReference.js";
import { sha256ContentHash } from "../../../mps-compliance/src/canonical/sha256Canonical.js";

export const LU_EXECUTION_SEED_CONTRACT = "LU_EXECUTION_SEED_V1" as const;

export function deriveLuExecutionSeed(input: {
  readonly site_id: string;
  readonly project_id: string;
  readonly project_context_ref: ArtifactReference;
  readonly property_context_ref: ArtifactReference;
  readonly project_context_binding_ref: ArtifactReference;
  readonly product_release_ref: ArtifactReference;
  readonly product_release_hash: string;
  readonly execution_contract_version: string;
  readonly rule_registry_snapshot_id: string;
  /**
   * PRODUCT-LU-LOCALIZATION-GEOMETRY-01. Optional, not defaulted: `undefined` is dropped by the
   * RFC8785 canonicalizer (same reasoning as `ExecutionIdentityArtifact.subject_v3`), so every
   * existing V1/V2 caller that does not pass this keeps deriving the exact same seed value as
   * before. A caller that DOES pass it gets a seed that is a pure function of the localization
   * point too -- same property + same project + same release + DIFFERENT point -> different seed.
   */
  readonly localization_geometry_ref?: ArtifactReference;
}): string {
  return sha256ContentHash({ contract: LU_EXECUTION_SEED_CONTRACT, ...input }).value;
}
