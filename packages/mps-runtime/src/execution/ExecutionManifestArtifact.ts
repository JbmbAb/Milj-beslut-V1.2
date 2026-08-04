import { ArtifactContract } from "../../../mps-compliance/src/artifacts/ArtifactContract";
import { ArtifactReference } from "../../../mps-compliance/src/artifacts/ArtifactReference";

/**
 * ExecutionManifestArtifact
 *
 * Defines exactly what will be executed.
 */
export interface ExecutionManifestArtifact extends ArtifactContract {
  readonly artifact_type: "execution_manifest";

  readonly execution_identity_ref: ArtifactReference;
  readonly capability_resolution_ref: ArtifactReference;

  readonly parameters: Record<string, unknown>;
}
