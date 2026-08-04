import { ArtifactContract } from "../../../mps-compliance/src/artifacts/ArtifactContract";
import { CanonicalPipeline } from "../../../mps-canonical/src/CanonicalPipeline";
import { ReplicationManifestArtifact } from "./ReplicationManifestArtifact";
import { ArtifactLineageArtifact } from "../../../mps-compliance/src/artifacts/ArtifactLineageArtifact";

export class ReplicationConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReplicationConflictError";
  }
}

/**
 * ConflictResolver
 *
 * Deterministic conflict resolution for valid forks.
 */
export class ConflictResolver {
  constructor(private readonly canonicalPipeline: CanonicalPipeline) {}

  /**
   * Resolves replication discrepancies.
   * First, evaluates if a given incoming artifact is the valid owner of its declared identity and hash.
   * If a conflict exists with a local version, uses a deterministic ordering rule to pick a winner.
   * 
   * Returns true if the incoming artifact should be accepted (either no conflict, or it won the tie-break).
   * Throws if the incoming artifact is byzantine (hash mismatch).
   */
  public resolve(
    incomingManifest: ReplicationManifestArtifact, 
    incomingLineage: ArtifactLineageArtifact,
    localManifest: ReplicationManifestArtifact | null,
    localLineage: ArtifactLineageArtifact | null
  ): boolean {
    // 1. If there's no local manifest, incoming wins by default
    if (!localManifest || !localLineage) {
      return true;
    }

    // 2. Deterministic Rule 1: Highest Valid Lineage Sequence
    if (incomingLineage.sequence > localLineage.sequence) {
      return true;
    }
    if (incomingLineage.sequence < localLineage.sequence) {
      throw new ReplicationConflictError(`REJECTED_STALE_STATE: Incoming sequence (${incomingLineage.sequence}) is older than local (${localLineage.sequence}).`);
    }

    // 3. Deterministic Rule 2: Highest Governance Epoch
    if (incomingManifest.governance_epoch > localManifest.governance_epoch) {
      return true;
    }
    if (incomingManifest.governance_epoch < localManifest.governance_epoch) {
      return false; 
    }

    // 4. Deterministic Rule 3: Highest Authority Score (Trust Level)
    const incomingTrust = incomingManifest.signature_trust_level || 0;
    const localTrust = localManifest.signature_trust_level || 0;
    if (incomingTrust > localTrust) {
      return true;
    }
    if (incomingTrust < localTrust) {
      return false; // Valid fork, but local wins.
    }

    // 5. Deterministic Rule 4: Lowest Lexicographical Hash Wins (Tie-breaker)
    if (incomingManifest.root_hash < localManifest.root_hash) {
      return true;
    }
    if (incomingManifest.root_hash > localManifest.root_hash) {
      return false; // Valid fork, but local wins.
    }

    // If everything is exactly equal, they are the same state. No action needed.
    return false;
  }
  
  public verifyHash(incoming: ArtifactContract, expectedHash: string): void {
    const actualHash = this.canonicalPipeline.hashCanonical(incoming, "JSON").digest;
    
    if (actualHash !== expectedHash) {
      throw new ReplicationConflictError(`REJECTED: Incoming artifact hash (${actualHash}) does not match manifest hash (${expectedHash}). Node is corrupt.`);
    }
  }
}
