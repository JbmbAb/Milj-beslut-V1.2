import { ArtifactContract } from "../../../mps-compliance/src/artifacts/ArtifactContract";
import { ArtifactReference } from "../../../mps-compliance/src/artifacts/ArtifactReference";

export interface TrustAnchorArtifact extends ArtifactContract {
  readonly anchor_name: string;
  readonly governance_profile: string;
}
