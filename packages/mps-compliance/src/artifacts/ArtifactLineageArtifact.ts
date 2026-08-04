import { ArtifactContract } from "./ArtifactContract";
import { ArtifactReference } from "./ArtifactReference";
import { ContentHash } from "./ContentHash";

/**
 * ArtifactLineageArtifact
 *
 * Implements historical state closure as a first-class immutable artifact.
 * Artifacts describe state. Lineage describes the relationship between states.
 */
export interface ArtifactLineageArtifact extends ArtifactContract {
  readonly artifact_type: "artifact_lineage";

  // The state artifact this lineage describes
  readonly subject_ref: ArtifactReference;

  // Hash of the previous state in the chain (null if genesis)
  readonly parent_hash: ContentHash | null;

  // Strictly monotonically increasing sequence number
  readonly sequence: number;

  // The actor/identity that created this state transition
  readonly created_by: ArtifactReference;

  // Hash of the root of the lineage tree to bind branches cryptographically
  readonly lineage_root_hash: ContentHash;
}
