import { ArtifactContract, ArtifactReference } from "./ArtifactContract";
import { ContentHash } from "./ContentHash";

/**
 * ProofResolutionArtifact
 * 
 * Records the deterministic output of navigating a specific proof path.
 * When a user queries "Why was this execution approved?", the resolution
 * results in this artifact to make the navigation event itself auditable.
 */
export interface ProofResolutionArtifact extends ArtifactContract {
  readonly artifact_type: "proof_resolution";

  // The artifact being resolved (e.g., an ExecutionOutcome)
  readonly target_ref: ArtifactReference;

  // The canonical root to which this resolution binds (e.g., FrozenCoreReleaseManifest)
  readonly root_release_ref: ArtifactReference;

  // The ordered path of artifacts providing the proof
  readonly path_refs: readonly ArtifactReference[];

  // Hash of the exact projected structure, proving what the resolver found
  readonly resolution_hash: ContentHash;

  // Identity of the session resolving the proof
  readonly created_by: ArtifactReference;

  // Enforces retention governance for the produced proof explanation
  readonly retention_policy_ref?: ArtifactReference;
}
