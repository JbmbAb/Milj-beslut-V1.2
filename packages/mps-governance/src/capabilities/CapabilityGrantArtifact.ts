import { ArtifactContract } from "../../../mps-compliance/src/artifacts/ArtifactContract";
import { ArtifactReference } from "../../../mps-compliance/src/artifacts/ArtifactReference";
import { ContentHash } from "../../../mps-compliance/src/artifacts/ContentHash";

/**
 * CapabilityGrantArtifact
 *
 * Immutable authorization binding.
 *
 * Binds actor, capability and scope
 * to exact canonical states.
 */
export interface CapabilityGrantArtifact extends ArtifactContract {
  readonly artifact_type: "capability_grant";

  readonly actor_ref: ArtifactReference;
  readonly actor_hash: ContentHash;

  readonly capability_ref: ArtifactReference;
  readonly capability_hash: ContentHash;

  readonly scope_ref: ArtifactReference;
  readonly scope_hash: ContentHash;
}
