import { ArtifactContract, ArtifactReference } from "./ArtifactContract";

/**
 * GovernanceRejectionArtifact
 * 
 * Provides negative evidence ("Why was this denied?"). 
 * It complements positive proofs by formalizing capability denials, rule failures, 
 * invalid signatures, or missing evidence as explicitly immutable artifacts.
 */
export interface GovernanceRejectionArtifact extends ArtifactContract {
  readonly artifact_type: "governance_rejection";

  // The artifact or attempt that was rejected
  readonly target_ref: ArtifactReference;

  // Why it was rejected
  readonly rejection_reason: "capability_denied" | "rule_failed" | "signature_invalid" | "evidence_missing";

  // Optional rule ID that triggered the rejection (e.g. from the compliance matrix)
  readonly rule_id?: string;

  // Specific evidence that failed validation or caused the rejection
  readonly evidence_refs?: readonly ArtifactReference[];

  // Optional hash of the diagnostic context that triggered the rejection
  readonly diagnostic_hash?: string;
}
