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
}): string {
  return sha256ContentHash({ contract: LU_EXECUTION_SEED_CONTRACT, ...input }).value;
}
