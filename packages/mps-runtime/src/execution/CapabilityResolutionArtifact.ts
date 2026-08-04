import { ArtifactContract } from "../../../mps-compliance/src/artifacts/ArtifactContract";
import { ArtifactReference } from "../../../mps-compliance/src/artifacts/ArtifactReference";

/**
 * CapabilityResolutionArtifact
 *
 * Resolves a capability into a concrete execution context.
 */
export interface CapabilityResolutionArtifact extends ArtifactContract {
  readonly artifact_type: "capability_resolution";

  readonly capability_ref: ArtifactReference;
  readonly actor_ref: ArtifactReference;

  readonly resolution_context: string;
}
