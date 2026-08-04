import { ArtifactContract } from "../../../mps-compliance/src/artifacts/ArtifactContract";
import { ArtifactReference } from "../../../mps-compliance/src/artifacts/ArtifactReference";
import { ContentHash } from "../../../mps-compliance/src/artifacts/ContentHash";

/**
 * ReplicationManifestArtifact
 *
 * Defines the intended distributed state payload.
 * It is a fully governed artifact containing a Merkle-like root hash over the specific subset 
 * of artifacts being replicated during this sync epoch.
 */
export interface ReplicationManifestArtifact extends ArtifactContract {
  readonly artifact_type: "replication_manifest";

  // Binding to the specific release that authorized this replication
  readonly release_hash: ContentHash;

  // The aggregated hash of all canonical bytes being replicated
  readonly root_hash: string;
  
  // Explicit reference to the lineage artifact providing temporal context
  readonly lineage_ref: ArtifactReference;
  
  // Governance epoch indicator (used for conflict resolution)
  readonly governance_epoch: number;

  // Expected artifact count for completeness check
  readonly artifact_count: number;

  // Optional: signature binding if this replication is strictly signed
  readonly signature_ref?: ArtifactReference;
  readonly signature_trust_level?: number;

  // List of expected artifact identities and their individual content hashes
  readonly contents: ReadonlyArray<{
    readonly artifact_id: string;
    readonly expected_hash: string;
  }>;
}
