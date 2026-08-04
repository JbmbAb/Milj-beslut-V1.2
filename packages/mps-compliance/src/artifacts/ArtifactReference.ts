import { ArtifactId } from "./ArtifactId";
import { ArtifactType } from "./ArtifactType";

/**
 * Canonical reference to another artifact.
 *
 * Carries identity, never creates it.
 */
export interface ArtifactReference {
  readonly artifact_id: ArtifactId;
  readonly artifact_type: ArtifactType;
}
