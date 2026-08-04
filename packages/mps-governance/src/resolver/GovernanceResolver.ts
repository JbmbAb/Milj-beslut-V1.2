import { ContentReference } from "@miljobeslut/mps-evolution";
import { GovernanceArtifact } from "../contracts/GovernanceArtifact.js";

export interface GovernanceResolutionTrace {
  readonly source: "ArtifactRepository";
  readonly artifact_ref: ContentReference;
}

export interface GovernanceResolver {
  resolveByRef(
    ref: ContentReference
  ): Promise<{
    artifact: GovernanceArtifact;
    trace: GovernanceResolutionTrace;
  }>;
}
