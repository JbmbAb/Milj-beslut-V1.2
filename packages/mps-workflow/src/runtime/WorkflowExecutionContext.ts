import { ContentReference } from "@miljobeslut/mps-evolution";

export interface WorkflowExecutionContext {
  readonly workflow_ref: ContentReference;

  readonly input_refs: readonly ContentReference[];

  /**
   * Runtime metadata only.
   * MUST NOT affect canonical identity.
   */
  readonly execution_id: string;
}
