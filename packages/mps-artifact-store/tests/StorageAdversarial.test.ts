import { describe, it, expect, beforeEach } from "vitest";
import { SecureArtifactStorage, RawStorage, StorageIntegrityError } from "../src/kernel/SecureArtifactStorage";
import { DefaultCanonicalPipeline } from "../../mps-canonical/src/CanonicalPipeline";
import { ArtifactContract } from "../../mps-compliance/src/artifacts/ArtifactContract";

class MockRawStorage implements RawStorage {
  private data = new Map<string, ArtifactContract>();
  
  read(ref: { artifact_id: string; artifact_type: string }): ArtifactContract | null {
    return this.data.get(ref.artifact_id) || null;
  }
  
  write(artifact: ArtifactContract): void {
    this.data.set(artifact.artifact_id, artifact);
  }

  // Backdoor for testing corruption
  corrupt(artifact_id: string, newArtifact: ArtifactContract) {
    this.data.set(artifact_id, newArtifact);
  }

  simulateCrashOnWrite(artifact_id: string) {
    // Write a corrupted partial blob
    this.data.set(artifact_id, { artifact_id, artifact_type: "corrupted_blob" } as any);
  }
}

describe("Artifact Storage Integrity Suite (MPS-17)", () => {
  let rawStorage: MockRawStorage;
  let pipeline: DefaultCanonicalPipeline;
  let secureStorage: SecureArtifactStorage;

  beforeEach(async () => {
    rawStorage = new MockRawStorage();
    pipeline = new DefaultCanonicalPipeline();
    await pipeline.initHasher();
    secureStorage = new SecureArtifactStorage(rawStorage, pipeline);
  });

  it("Attack 1: Artifact Substitution (ContentHash mismatch)", () => {
    const originalArtifact: ArtifactContract = {
      artifact_id: "test-manifest-1",
      artifact_type: "execution_manifest",
      foo: "bar"
    } as any;

    const validHash = secureStorage.commit(originalArtifact);

    // Adversary directly corrupts the underlying storage blob
    const corruptedArtifact: ArtifactContract = {
      artifact_id: "test-manifest-1",
      artifact_type: "execution_manifest",
      foo: "evil-injected-payload"
    } as any;
    rawStorage.corrupt("test-manifest-1", corruptedArtifact);

    // Runtime attempts to resolve it, trusting the expected validHash
    expect(() => secureStorage.resolve({ artifact_id: "test-manifest-1", artifact_type: "execution_manifest" }, validHash))
      .toThrowError(StorageIntegrityError);
  });

  it("Attack 2: Repository Lies (Artifact Identity mismatch)", () => {
    const targetArtifact: ArtifactContract = {
      artifact_id: "target-123",
      artifact_type: "execution_manifest",
      content_hash: { algorithm: "sha256", value: "hash" } as any,
      references: []
    };
    secureStorage.commit(targetArtifact);

    // Adversary tricks repository into serving a completely different, but internally valid artifact
    const decoyArtifact: ArtifactContract = {
      artifact_id: "decoy-456",
      artifact_type: "execution_manifest",
      content_hash: { algorithm: "sha256", value: "hash" } as any,
      references: []
    };
    // Map the requested ID to the decoy artifact
    rawStorage.corrupt("target-123", decoyArtifact);

    // Runtime asks for "target-123"
    expect(() => secureStorage.resolve({ artifact_id: "target-123", artifact_type: "execution_manifest" }))
      .toThrowError(/Repository Lies/);
  });

  it("Attack 3: Partial Persistence Failure (Crash between blob and ledger)", () => {
    const artifact: ArtifactContract = {
      artifact_id: "crash-test",
      artifact_type: "capability_grant",
      scope: "global"
    } as any;

    // We mock the rawStorage.write to simulate writing partial garbage, then failing to write to index/ledger
    const originalWrite = rawStorage.write.bind(rawStorage);
    rawStorage.write = (a) => {
      rawStorage.simulateCrashOnWrite(a.artifact_id);
    };

    // The commit should fail immediately because the readback verification will fail
    expect(() => secureStorage.commit(artifact)).toThrowError(/Partial Persistence Failure/);
  });

  it("Attack 4: Cross-platform Canonicalization", () => {
    // Artifact created on a Windows system (CRLF, weird key order)
    const artifactWindows: any = {
      artifact_type: "policy",
      artifact_id: "policy-1",
      rules: "rule1\r\nrule2",
      description: "  whitespace  "
    };

    // Same logical artifact created on Linux (LF, different key order)
    const artifactLinux: any = {
      description: "  whitespace  ",
      artifact_id: "policy-1",
      rules: "rule1\nrule2", // Wait, canonical JSON doesn't magically normalize CRLF to LF in strings unless specified by application. 
      // Mimer canonical rules state that whitespace outside strings is stripped. Inside strings it matters. 
      // But the object key ordering MUST be deterministic.
      artifact_type: "policy"
    };

    // Actually, string content CRLF vs LF is a domain issue. Key ordering is a canonicalization issue.
    // Let's test key ordering and spacing which canonical JSON normalizes.
    const artifactA = JSON.parse(`{
      "artifact_id": "test-1",
      "artifact_type": "type-1",
      "data": { "z": 1, "a": 2 }
    }`);

    const artifactB = JSON.parse(`{"data":{"a":2,"z":1},"artifact_type":"type-1","artifact_id":"test-1"}`);

    const hashA = pipeline.hashCanonical(artifactA, "JSON").digest;
    const hashB = pipeline.hashCanonical(artifactB, "JSON").digest;

    expect(hashA).toEqual(hashB);
  });
});
