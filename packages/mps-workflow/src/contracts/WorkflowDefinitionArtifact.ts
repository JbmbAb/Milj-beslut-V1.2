import { CanonicalArtifact, ContentReference } from "@miljobeslut/mps-evolution";
import { Permission } from "@miljobeslut/mps-capability/src/types";
import { WorkflowStep } from "./WorkflowStep.js";

export interface WorkflowDefinitionArtifact extends CanonicalArtifact {
  readonly artifact_type: "WORKFLOW_DEFINITION";

  /**
   * Semantic metadata only.
   * SHALL NOT affect canonical identity.
   */
  readonly workflow_key: string;
  readonly workflow_version: string;

  /**
   * Declarative execution graph.
   */
  readonly steps: readonly WorkflowStep[];

  /**
   * Workflow does not own capability definitions.
   */
  readonly required_capabilities: readonly ContentReference[];

  /**
   * Declarative policy metadata.
   * Identity-neutral.
   */
  readonly required_permissions: readonly Permission[];
}
