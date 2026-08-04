import { CanonicalArtifact, ContentReference } from "@miljobeslut/mps-evolution";

export interface AuditArtifact extends CanonicalArtifact {
  readonly artifact_type: "AUDIT_ARTIFACT";

  readonly subject_ref: ContentReference;
  readonly trigger_ref: ContentReference;

  readonly audit_key: string;
}

export interface AuditEvidence {
  readonly evidence_refs: readonly ContentReference[];
}

export interface EvidenceBoundAuditArtifact extends AuditArtifact {
  readonly evidence: AuditEvidence;
}

export interface AuditChain {
  readonly previous_audit_ref?: ContentReference;
  readonly previous_audit_hash?: string;
}

export interface ChainedAuditArtifact extends AuditArtifact {
  readonly chain: AuditChain;
}

export interface AuditReconstruction {
  readonly definition_refs: readonly ContentReference[];
  readonly execution_refs: readonly ContentReference[];
  readonly event_refs: readonly ContentReference[];
  readonly decision_refs: readonly ContentReference[];
}

export interface ReconstructionBoundAuditArtifact extends AuditArtifact {
  readonly reconstruction: AuditReconstruction;
}
