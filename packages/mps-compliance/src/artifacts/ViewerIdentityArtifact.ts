import { ArtifactContract } from "./ArtifactContract";

/**
 * ViewerIdentityArtifact
 * 
 * Formalizes the identity of the human/system observer.
 * A ViewerCapabilityArtifact must bind its viewer_identity_ref to this artifact
 * so that we know exactly who is holding the capability.
 */
export interface ViewerIdentityArtifact extends ArtifactContract {
  readonly artifact_type: "viewer_identity";
  readonly viewer_name: string;
  readonly internal_subject_id: string; // e.g., an SSO or JWT sub claim
}
