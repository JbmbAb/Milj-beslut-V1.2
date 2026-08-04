import { ContentReference } from "@miljobeslut/mps-evolution";

export interface WorkflowInputMapping {
  readonly from_ref: ContentReference;
  readonly to_parameter: string;
}

export interface WorkflowOutputMapping {
  readonly from_ref: ContentReference;
  readonly to_ref: ContentReference;
}

export interface WorkflowStep {
  /**
   * Semantic only.
   */
  readonly step_key: string;

  /**
   * Canonical execution ordering.
   * Deterministic identity.
   */
  readonly sequence: number;

  /**
   * Must resolve to CapabilityDefinition.
   */
  readonly capability_ref: ContentReference;

  readonly input_mapping: readonly WorkflowInputMapping[];
  readonly output_mapping: readonly WorkflowOutputMapping[];
}
