import { ArtifactContract } from "../../../mps-compliance/src/artifacts/ArtifactContract";
import { ArtifactReference } from "../../../mps-compliance/src/artifacts/ArtifactReference";
import { ContentHash } from "../../../mps-compliance/src/artifacts/ContentHash";

export interface TrustAnchorArtifact extends ArtifactContract {
  readonly artifact_type: "trust_anchor";
  readonly anchor_name: string;
  readonly governance_profile: string;

  /**
   * Minimal root binding required to close actor-trust traversal.
   * Optional only for historical artifacts; authority verification fails closed
   * when either field is absent.
   */
  readonly root_actor_ref?: ArtifactReference;
  readonly root_actor_hash?: ContentHash;

  /**
   * Trusted key used to verify delegation-status attestations. This does not
   * grant authority by key possession alone; the full actor/domain/grant/path
   * closure still has to verify.
   */
  readonly verification_key_id?: string;
}
