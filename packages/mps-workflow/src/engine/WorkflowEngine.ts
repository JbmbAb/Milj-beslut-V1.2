import { ContentReference } from "@miljobeslut/mps-evolution";
import { WorkflowExecutionArtifact } from "../artifacts/WorkflowExecutionArtifact.js";

export interface WorkflowEngine {
  /**
   * Executes a canonical workflow definition.
   *
   * SHALL:
   * - resolve workflow via WorkflowResolver
   * - resolve capabilities via CapabilityResolver
   * - use ArtifactRepository for all references
   * - preserve provenance
   * - produce deterministic execution artifacts
   * - never create capability definitions
   */
  execute(
    workflow_ref: ContentReference,
    input_refs: readonly ContentReference[]
  ): Promise<WorkflowExecutionArtifact>;
}
