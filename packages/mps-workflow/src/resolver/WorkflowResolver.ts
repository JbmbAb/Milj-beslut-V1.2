import { ContentReference } from "@miljobeslut/mps-evolution";
import { WorkflowDefinitionArtifact } from "../contracts/WorkflowDefinitionArtifact.js";

export interface WorkflowResolutionTrace {
  readonly source: "ArtifactRepository";
  readonly artifact_ref: ContentReference;
}

export interface WorkflowResolver {
  resolveByRef(
    ref: ContentReference
  ): Promise<{
    definition: WorkflowDefinitionArtifact;
    trace: WorkflowResolutionTrace;
  }>;
}
