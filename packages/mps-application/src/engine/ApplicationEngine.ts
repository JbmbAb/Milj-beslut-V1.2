import { ContentReference } from "@miljobeslut/mps-evolution";
import { ApplicationExecutionArtifact } from "../artifacts/ApplicationExecutionArtifact.js";

export interface ApplicationEngine {
  execute(
    application_ref: ContentReference,
    input_refs: readonly ContentReference[]
  ): Promise<ApplicationExecutionArtifact>;
}
