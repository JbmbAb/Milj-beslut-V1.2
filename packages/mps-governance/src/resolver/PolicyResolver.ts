import { ContentReference } from "@miljobeslut/mps-evolution";
import { PolicyArtifact } from "../contracts/PolicyArtifact.js";

export interface PolicyResolutionTrace {
  readonly source: "ArtifactRepository";
  readonly artifact_ref: ContentReference;
}

export interface PolicyResolver {
  resolveByRef(
    ref: ContentReference
  ): Promise<{
    policy: PolicyArtifact;
    trace: PolicyResolutionTrace;
  }>;
}
