import { ArtifactContract, ArtifactReference } from "./ArtifactContract";
import { ContentHash } from "./ContentHash";

/**
 * ViewerCapabilityArtifact
 * 
 * Formalizes capability-based access control for the presentation layer.
 * Enforces VIEW-22-I2 (Capability Provenance) to guarantee that the capability
 * itself is not a root of trust, but has proper governance backing.
 */
export interface ViewerCapabilityArtifact extends ArtifactContract {
  readonly artifact_type: "viewer_capability";
  
  // Provenance fields
  readonly viewer_identity_ref: ArtifactReference;
  readonly granted_by: ArtifactReference;
  readonly policy_ref: ArtifactReference;
  
  // Bind capability strictly to a release (Release isolation)
  readonly release_hash: ContentHash;

  // Strict temporal validity window for human governance
  readonly valid_from: string; // ISO8601
  readonly valid_until: string; // ISO8601

  // Granular rights matching the Proof Path Resolution system
  readonly can_view_domain_evidence: boolean;
  readonly allowed_operations: readonly string[];
  readonly denied_operations: readonly string[];
}
