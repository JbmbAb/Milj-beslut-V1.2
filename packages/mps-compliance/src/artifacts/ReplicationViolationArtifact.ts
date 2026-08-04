import { ArtifactContract } from "./ArtifactContract";
import { ArtifactReference } from "./ArtifactReference";

/**
 * ReplicationViolationArtifact
 *
 * Cryptographic evidence of a rejected distributed state mutation attempt.
 * Preserves the audit trail for byzantine behavior.
 */
export interface ReplicationViolationArtifact extends ArtifactContract {
  readonly artifact_type: "replication_violation";

  // The node or identity that attempted the violation
  readonly node_ref: ArtifactReference;

  readonly violation_code: 
    | "STALE_STATE"
    | "HASH_MISMATCH"
    | "FORK_CONFLICT"
    | "INCOMPLETE_REPLICATION"
    | "WRONG_RELEASE_BINDING";

  // The exact content hash of the object that was rejected
  readonly rejected_hash: string; // Storing as string to match ContentHash interface usage typically

  // The node or identity that detected the violation
  readonly detected_by: ArtifactReference;

  // The artifacts involved in the violation (e.g. the rejected manifest)
  readonly evidence_refs: readonly ArtifactReference[];
}
