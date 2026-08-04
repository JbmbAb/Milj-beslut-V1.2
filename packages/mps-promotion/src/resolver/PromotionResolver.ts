import { ContentReference } from "@miljobeslut/mps-evolution";
import { PromotionCandidateArtifact } from "../contracts/PromotionCandidateArtifact.js";

export interface PromotionResolutionTrace {
  readonly source: "ArtifactRepository";
  readonly artifact_ref: ContentReference;
}

export interface PromotionResolver {
  resolveByRef(
    ref: ContentReference
  ): Promise<{
    candidate: PromotionCandidateArtifact;
    trace: PromotionResolutionTrace;
  }>;
}
