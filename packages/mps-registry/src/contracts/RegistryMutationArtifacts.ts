import { CanonicalArtifact, ContentReference } from "@miljobeslut/mps-evolution";

export type MutationType = "REGISTER" | "DEPRECATE" | "REVOKE" | "ROLLBACK";

// ADR-24-13: Registry Mutation Artifacts
export interface RegistryMutationRequestArtifact extends CanonicalArtifact {
  readonly artifact_type: "REGISTRY_MUTATION_REQUEST_ARTIFACT";

  // REG-24-13-I1: Decision Authority
  // Registry SHALL NOT mutate state without a valid PromotionDecisionArtifact reference.
  readonly promotion_decision_ref: ContentReference;

  readonly target_subject_ref: ContentReference;
  readonly mutation_type: MutationType;
  
  readonly previous_state_ref?: ContentReference;
  readonly desired_state_metadata?: unknown;
}

export interface RegistryMutationExecutionArtifact extends CanonicalArtifact {
  readonly artifact_type: "REGISTRY_MUTATION_EXECUTION_ARTIFACT";

  readonly request_ref: ContentReference;

  readonly final_state_ref: ContentReference;

  readonly status: "COMMITTED" | "FAILED" | "ROLLED_BACK";
  
  readonly execution_timestamp: string;
}
