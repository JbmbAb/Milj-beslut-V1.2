import { ArtifactContract } from "../../../mps-compliance/src/artifacts/ArtifactContract";

/**
 * CapabilityArtifact
 *
 * Defines a named capability that may be granted to actors.
 */
export interface CapabilityArtifact extends ArtifactContract {
  readonly artifact_type: "capability";

  readonly capability_name: string;
  readonly description: string;
}
