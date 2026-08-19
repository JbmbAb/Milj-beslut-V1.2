import { describe, it, expect, beforeEach } from "vitest";
import { ArtifactContract } from "../../mps-compliance/src/artifacts/ArtifactContract";
import { ArtifactLineageArtifact } from "../../mps-compliance/src/artifacts/ArtifactLineageArtifact";
import { DefaultCanonicalPipeline } from "../../mps-canonical/src/CanonicalPipeline";
import { SecureArtifactStorage, RawStorage } from "../src/kernel/SecureArtifactStorage";
import { ArtifactSyncProtocol, SyncProtocolError } from "../src/replication/ArtifactSyncProtocol";
import { ConflictResolver, ReplicationConflictError } from "../src/replication/ConflictResolver";
import { ReplicationManifestArtifact } from "../src/replication/ReplicationManifestArtifact";

class MockRawStorage implements RawStorage {
  private data = new Map<string, ArtifactContract>();
  
  read(ref: { artifact_id: string; artifact_type: string }): ArtifactContract | null {
    return this.data.get(ref.artifact_id) || null;
  }
  
  write(artifact: ArtifactContract): void {
    // Basic immutable check simulation
    if (this.data.has(artifact.artifact_id)) {
      throw new Error(`Immutable ledger exception: Artifact ${artifact.artifact_id} already exists`);
    }
    this.data.set(artifact.artifact_id, artifact);
  }
}

describe("Distributed State Closure (MPS-19)", () => {
  let pipeline: DefaultCanonicalPipeline;
  let nodeAStorage: SecureArtifactStorage;
  let protocolA: ArtifactSyncProtocol;
  let resolver: ConflictResolver;
  const RELEASE_HASH: any = { algorithm: "sha256", value: "release-1.0-frozen-core" };

  beforeEach(async () => {
    pipeline = new DefaultCanonicalPipeline();
    await pipeline.initHasher();

    const rawStorageA = new MockRawStorage();
    nodeAStorage = new SecureArtifactStorage(rawStorageA, pipeline);
    resolver = new ConflictResolver(pipeline);
    protocolA = new ArtifactSyncProtocol(nodeAStorage, resolver, pipeline);
  });

  const createLineage = (id: string, seq: number): ArtifactLineageArtifact => ({
    artifact_id: id,
    artifact_type: "artifact_lineage",
    subject_ref: { artifact_id: "state", artifact_type: "any" },
    parent_hash: null,
    sequence: seq,
    created_by: { artifact_id: "node", artifact_type: "node_identity" },
    lineage_root_hash: { algorithm: "sha256", value: "root-hash" } as any,
    content_hash: { algorithm: "sha256", value: "hash" } as any,
    references: []
  });

  const createManifest = (
      id: string, 
      lineageId: string,
      epoch: number,
      trust: number, 
      root: string, 
      release: string, 
      contents: any[]
  ): ReplicationManifestArtifact => ({
      artifact_id: id,
      artifact_type: "replication_manifest",
      release_hash: release as any,
      root_hash: root as any,
      lineage_ref: { artifact_id: lineageId, artifact_type: "artifact_lineage" },
      governance_epoch: epoch,
      signature_trust_level: trust,
      artifact_count: contents.length,
      contents: contents,
      content_hash: { algorithm: "sha256", value: "hash" } as any,
      references: []
  });

  it("Attack 1: Replay old valid artifact (Stale State) produces ReplicationViolationArtifact", () => {
    const localLineage = createLineage("lin-local", 5);
    const localManifest = createManifest("man-local", "lin-local", 1, 10, "rootA", RELEASE_HASH as any, []);
    protocolA.setLocalState(localManifest, localLineage);

    const incomingLineage = createLineage("lin-incoming", 4);
    const incomingManifest = createManifest("man-incoming", "lin-incoming", 1, 10, "rootB", RELEASE_HASH as any, []);

    try {
        protocolA.receivePush(incomingManifest, incomingLineage, []);
        expect.fail("Should have thrown");
    } catch (e: any) {
        expect(e).toBeInstanceOf(SyncProtocolError);
        expect(e.message).toMatch(/REJECTED_STALE_STATE/);
        expect(e.violation).toBeDefined();
        expect(e.violation.violation_code).toBe("STALE_STATE");
        expect(e.violation.evidence_refs.map((r: any) => r.artifact_id)).toContain("man-incoming");
        expect(e.violation.evidence_refs.map((r: any) => r.artifact_id)).toContain("lin-incoming");
    }
  });

  it("Attack 2: Manifest substitution (Wrong Release Binding) produces ReplicationViolationArtifact", () => {
    const localLineage = createLineage("lin-local", 5);
    const localManifest = createManifest("man-local", "lin-local", 1, 10, "rootA", RELEASE_HASH as any, []);
    protocolA.setLocalState(localManifest, localLineage);

    const incomingLineage = createLineage("lin-incoming", 6);
    const incomingManifest = createManifest("man-incoming", "lin-incoming", 1, 10, "rootB", "wrong-release-hash", []);

    try {
        protocolA.receivePush(incomingManifest, incomingLineage, []);
        expect.fail("Should have thrown");
    } catch (e: any) {
        expect(e).toBeInstanceOf(SyncProtocolError);
        expect(e.message).toMatch(/REJECTED_WRONG_RELEASE_BINDING/);
        expect(e.violation).toBeDefined();
        expect(e.violation.violation_code).toBe("WRONG_RELEASE_BINDING");
    }
  });

  it("Attack 3: Fork attack (Deterministic Conflict Resolution) over 1000 iterations", () => {
    const manifestA = createManifest("manA", "linA", 1, 50, "hash-ZZZ", RELEASE_HASH as any, []);
    const lineageA = createLineage("linA", 5);

    const manifestB = createManifest("manB", "linB", 1, 50, "hash-AAA", RELEASE_HASH as any, []);
    const lineageB = createLineage("linB", 5);
    
    // Test: A is local, B is incoming. B should win because hash-AAA < hash-ZZZ
    const results = [];
    for(let i=0; i<1000; i++) {
        const accept = resolver.resolve(manifestB, lineageB, manifestA, lineageA);
        results.push(accept ? manifestB.root_hash : manifestA.root_hash);
    }
    
    expect(new Set(results).size).toBe(1);
    expect(results[0]).toBe("hash-AAA");
  });

  it("Attack 4: Partial replication produces ReplicationViolationArtifact", () => {
    const incomingLineage = createLineage("lin-incoming", 1);
    const incomingManifest = createManifest("man-incoming", "lin-incoming", 1, 50, "rootA", RELEASE_HASH as any, [
        { artifact_id: "art-1", expected_hash: "hash1" },
        { artifact_id: "art-2", expected_hash: "hash2" }
    ]);
    
    const payload: ArtifactContract[] = [{
        artifact_id: "art-1",
        artifact_type: "evidence",
        content_hash: { algorithm: "sha256", value: "hash" } as any,
        references: []
    }];

    try {
        protocolA.receivePush(incomingManifest, incomingLineage, payload);
        expect.fail("Should have thrown");
    } catch (e: any) {
        expect(e).toBeInstanceOf(SyncProtocolError);
        expect(e.message).toMatch(/INCOMPLETE_REPLICATION/);
        expect(e.violation).toBeDefined();
        expect(e.violation.violation_code).toBe("INCOMPLETE_REPLICATION");
    }
  });

  it("Legacy Phase 18 Attack: Payload Mutation produces ReplicationViolationArtifact", () => {
      const artifactX: ArtifactContract = {
        artifact_id: "art-x",
        artifact_type: "evidence",
        content_hash: { algorithm: "sha256", value: "hash" }, references: []
      };
      const genuineHash = pipeline.hashCanonical(artifactX, "JSON").digest;

      const incomingLineage = createLineage("lin-incoming", 1);
      const manifest = createManifest("man-incoming", "lin-incoming", 1, 50, "rootA", RELEASE_HASH as any, [
        { artifact_id: "art-x", expected_hash: genuineHash }
      ]);
      
      // Mutated relative to artifactX: same identity, different content_hash.value, so its
      // canonical hash genuinely differs from genuineHash. The previous fixture was byte-for-byte
      // identical to artifactX, so there was nothing for verifyHash() to actually catch.
      const corruptedPayload: ArtifactContract[] = [{
        artifact_id: "art-x",
        artifact_type: "evidence",
        content_hash: { algorithm: "sha256", value: "corrupted-hash" }, references: []
      }];
  
      try {
        protocolA.receivePush(manifest, incomingLineage, corruptedPayload);
        expect.fail("Should have thrown");
      } catch (e: any) {
        expect(e).toBeInstanceOf(SyncProtocolError);
        expect(e.message).toMatch(/HASH_MISMATCH/);
        expect(e.violation).toBeDefined();
        expect(e.violation.violation_code).toBe("HASH_MISMATCH");
        expect(e.violation.rejected_hash).toBe(genuineHash);
      }
  });
});
