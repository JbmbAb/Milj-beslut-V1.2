import { ArtifactContract } from "../../../mps-compliance/src/artifacts/ArtifactContract";
import { ArtifactReference } from "../../../mps-compliance/src/artifacts/ArtifactReference";

export interface TrustDelegationArtifact extends ArtifactContract {
  readonly from_actor_ref: ArtifactReference;
  readonly to_actor_ref: ArtifactReference;
  readonly domain_ref: ArtifactReference;
  readonly authority_scope: string;
}
