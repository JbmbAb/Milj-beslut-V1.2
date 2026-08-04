import { ArtifactContract } from "../../../mps-compliance/src/artifacts/ArtifactContract";
import { ArtifactReference } from "../../../mps-compliance/src/artifacts/ArtifactReference";

export interface TrustDomainArtifact extends ArtifactContract {
  readonly anchor_ref: ArtifactReference;
  readonly domain_name: string;
}
