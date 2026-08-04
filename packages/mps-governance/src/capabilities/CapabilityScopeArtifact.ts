import { ArtifactContract } from "../../../mps-compliance/src/artifacts/ArtifactContract";
import { ArtifactReference } from "../../../mps-compliance/src/artifacts/ArtifactReference";

/**
 * CapabilityScopeArtifact
 *
 * Defines the scope in which a capability is valid.
 */
export interface CapabilityScopeArtifact extends ArtifactContract {
  readonly artifact_type: "capability_scope";

  readonly capability_ref: ArtifactReference;
  readonly scope_name: string;
  readonly constraints: Record<string, unknown>;
}
