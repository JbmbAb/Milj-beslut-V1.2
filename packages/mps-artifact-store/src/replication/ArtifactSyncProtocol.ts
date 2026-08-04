import { ArtifactContract } from "../../../mps-compliance/src/artifacts/ArtifactContract";
import { ReplicationManifestArtifact } from "./ReplicationManifestArtifact";
import { ConflictResolver } from "./ConflictResolver";
import { SecureArtifactStorage } from "../kernel/SecureArtifactStorage";
import { ArtifactLineageArtifact } from "../../../mps-compliance/src/artifacts/ArtifactLineageArtifact";
import { ReplicationViolationArtifact } from "../../../mps-compliance/src/artifacts/ReplicationViolationArtifact";
import { CanonicalPipeline } from "../../../mps-canonical/src/CanonicalPipeline";

export class SyncProtocolError extends Error {
  public violation?: ReplicationViolationArtifact;
  constructor(message: string, violation?: ReplicationViolationArtifact) {
    super(message);
    this.name = "SyncProtocolError";
    this.violation = violation;
  }
}

/**
 * ArtifactSyncProtocol
 *
 * Implements the decentralized replication verification layer and temporal state closure.
 */
export class ArtifactSyncProtocol {
  private localManifest: ReplicationManifestArtifact | null = null;
  private localLineage: ArtifactLineageArtifact | null = null;
  private readonly expectedReleaseHash = "release-1.0-frozen-core"; // Mock for Context

  constructor(
    private readonly secureStorage: SecureArtifactStorage,
    private readonly conflictResolver: ConflictResolver,
    private readonly canonicalPipeline: CanonicalPipeline
  ) {}
  
  public setLocalState(manifest: ReplicationManifestArtifact, lineage: ArtifactLineageArtifact) {
      this.localManifest = manifest;
      this.localLineage = lineage;
  }

  private createViolation(code: ReplicationViolationArtifact["violation_code"], rejectedHash: string, refs: string[]): ReplicationViolationArtifact {
    return {
      artifact_id: `violation-${Date.now()}`,
      artifact_type: "replication_violation",
      node_ref: { artifact_id: "remote-node", artifact_type: "node_identity" },
      violation_code: code,
      rejected_hash: rejectedHash,
      detected_by: { artifact_id: "local-node", artifact_type: "node_identity" },
      evidence_refs: refs.map(id => ({ artifact_id: id, artifact_type: "any" }))
    };
  }

  /**
   * Processes an incoming push from a remote node (Node B).
   * 
   * @param manifest The Merkle-like manifest asserting the state.
   * @param lineage The temporal sequence context.
   * @param payload The raw artifacts corresponding to the manifest.
   */
  public receivePush(
    manifest: ReplicationManifestArtifact, 
    lineage: ArtifactLineageArtifact, 
    payload: ArtifactContract[]
  ): void {
    
    // 0. Verify Release Binding (Attack 2 Defense)
    if (manifest.release_hash !== this.expectedReleaseHash) {
        const violation = this.createViolation("WRONG_RELEASE_BINDING", manifest.root_hash, [manifest.artifact_id]);
        throw new SyncProtocolError("REJECTED_WRONG_RELEASE_BINDING: Manifest belongs to another release.", violation);
    }

    // 1. Conflict Resolution (Attack 1 & 3 Defense)
    let shouldAccept = false;
    try {
      shouldAccept = this.conflictResolver.resolve(manifest, lineage, this.localManifest, this.localLineage);
    } catch(e: any) {
      if (e.message.includes("REJECTED_STALE_STATE")) {
        const violation = this.createViolation("STALE_STATE", manifest.root_hash, [manifest.artifact_id, lineage.artifact_id]);
        throw new SyncProtocolError(e.message, violation);
      }
      throw e;
    }

    if (!shouldAccept) {
        // Drop silently if local wins tie-breaker, but in tests we might just return
        return; 
    }

    // 2. Completeness Verification (Attack 4 Defense)
    if (manifest.artifact_count !== payload.length) {
      const violation = this.createViolation("INCOMPLETE_REPLICATION", manifest.root_hash, [manifest.artifact_id]);
      throw new SyncProtocolError("INCOMPLETE_REPLICATION: Payload size mismatch with manifest", violation);
    }

    // 3. Process each artifact sequentially
    for (const item of manifest.contents) {
      const artifact = payload.find(p => p.artifact_id === item.artifact_id);
      if (!artifact) {
        const violation = this.createViolation("INCOMPLETE_REPLICATION", manifest.root_hash, [manifest.artifact_id, item.artifact_id]);
        throw new SyncProtocolError(`INCOMPLETE_REPLICATION: Missing artifact ${item.artifact_id} declared in manifest`, violation);
      }

      // 4. The conflict resolver enforces that the incoming artifact physically hashes 
      // to the exact hash expected by the manifest.
      try {
        this.conflictResolver.verifyHash(artifact, item.expected_hash);
      } catch (e: any) {
        const violation = this.createViolation("HASH_MISMATCH", item.expected_hash, [manifest.artifact_id, item.artifact_id]);
        throw new SyncProtocolError(`HASH_MISMATCH: ${e.message}`, violation);
      }
      
      // 5. SecureStorage will again verify the artifact during commit.
      try {
        this.secureStorage.commit(artifact);
      } catch (e: any) {
        throw new SyncProtocolError(`REJECTED: Artifact storage refused commit: ${e.message}`);
      }
    }
    
    // Accept new state
    this.localManifest = manifest;
    this.localLineage = lineage;
  }
}
