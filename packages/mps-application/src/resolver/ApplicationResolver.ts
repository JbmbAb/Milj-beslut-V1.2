import { ContentReference } from "@miljobeslut/mps-evolution";
import { ApplicationDefinitionArtifact } from "../contracts/ApplicationDefinitionArtifact.js";

export interface ApplicationResolutionTrace {
  readonly source: "ArtifactRepository";
  readonly artifact_ref: ContentReference;
}

export interface ApplicationResolver {
  resolveByRef(
    ref: ContentReference
  ): Promise<{
    definition: ApplicationDefinitionArtifact;
    trace: ApplicationResolutionTrace;
  }>;
}
