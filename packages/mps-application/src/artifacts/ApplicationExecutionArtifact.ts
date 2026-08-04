import { CanonicalArtifact, ContentReference } from "@miljobeslut/mps-evolution";

export type ApplicationExecutionResult = "SUCCESS" | "FAILED";

export interface ApplicationExecutionArtifact extends CanonicalArtifact {
  readonly artifact_type: "APPLICATION_EXECUTION";

  readonly application_definition_ref: ContentReference;
  readonly workflow_execution_refs: readonly ContentReference[];

  readonly input_refs: readonly ContentReference[];
  readonly output_refs: readonly ContentReference[];

  readonly execution_result: ApplicationExecutionResult;
}
