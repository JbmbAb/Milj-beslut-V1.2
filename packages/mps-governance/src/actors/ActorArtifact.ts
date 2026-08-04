import { ArtifactContract } from "../../../mps-compliance/src/artifacts/ArtifactContract";
import { ArtifactReference } from "../../../mps-compliance/src/artifacts/ArtifactReference";

export type ActorKind = "human" | "service" | "system";

export interface ActorArtifact extends ArtifactContract {
  readonly kind: ActorKind;
  readonly trust_domain_ref: ArtifactReference;
  readonly lifecycle_ref: ArtifactReference;
}
