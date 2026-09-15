import { ArtifactContract } from "../../../mps-compliance/src/artifacts/ArtifactContract";
import { ArtifactReference } from "../../../mps-compliance/src/artifacts/ArtifactReference";
import { ContentHash } from "../../../mps-compliance/src/artifacts/ContentHash";

export type ActorKind = "human" | "service" | "system";

export interface ActorArtifact extends ArtifactContract {
  readonly artifact_type: "actor";
  readonly kind: ActorKind;

  /**
   * Stable canonical identity. Optional only for historical actor artifacts;
   * authority-critical verification rejects an actor that lacks this closure.
   */
  readonly identity_ref?: ArtifactReference;
  readonly identity_hash?: ContentHash;

  readonly trust_domain_ref: ArtifactReference;
  readonly lifecycle_ref: ArtifactReference;
}
