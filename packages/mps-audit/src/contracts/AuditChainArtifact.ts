import { CanonicalArtifact, ContentReference } from "@miljobeslut/mps-evolution";

export interface AuditChainArtifact extends CanonicalArtifact {
  readonly artifact_type: "AUDIT_CHAIN_ARTIFACT";

  // AUD-24-14-I6, I7: Provenance
  readonly source_ref: ContentReference;
  readonly ast_ref: ContentReference;
  readonly analysis_ref: ContentReference;
  readonly evaluation_ref: ContentReference;
  readonly compliance_ref: ContentReference;
  
  readonly promotion_evaluation_ref: ContentReference;
  readonly promotion_decision_ref: ContentReference;
  
  readonly mutation_request_ref: ContentReference;
  readonly mutation_execution_ref: ContentReference;
  
  readonly previous_registry_state_ref: ContentReference;
  readonly next_registry_state_ref: ContentReference;
  
  readonly lineage_refs: readonly ContentReference[];
  
  readonly auditor_version: string;
}
