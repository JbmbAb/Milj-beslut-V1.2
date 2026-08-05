import { ArtifactContract } from "../../../mps-compliance/src/artifacts/ArtifactContract";
import { ArtifactReference } from "../../../mps-compliance/src/artifacts/ArtifactReference";
import { CanonicalPipeline } from "../../../mps-canonical/src/CanonicalPipeline";

export class StorageIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageIntegrityError";
  }
}

export interface RawStorage {
  read(ref: ArtifactReference): ArtifactContract | null;
  write(artifact: ArtifactContract): void;
}

/**
 * SecureArtifactStorage
 *
 * Implements Phase 17: Artifact Storage Integrity.
 * Zero-trust wrapper around any RawStorage implementation.
 */
export class SecureArtifactStorage {
  constructor(
    private readonly rawStorage: RawStorage,
    private readonly canonicalPipeline: CanonicalPipeline
  ) {}

  public resolve(ref: ArtifactReference, expectedHash?: string): ArtifactContract | null {
    const artifact = this.rawStorage.read(ref);
    if (!artifact) return null;

    // Attack 2 Defense: Repository Lies
    if (artifact.artifact_id !== ref.artifact_id || artifact.artifact_type !== ref.artifact_type) {
      throw new StorageIntegrityError("DENIED: Repository Lies. Resolved artifact does not match requested Identity.");
    }

    // Attack 1 & 4 Defense: Artifact Substitution and Canonicalization
    const actualHashDescriptor = this.canonicalPipeline.hashCanonical(artifact, "JSON");
    const actualHash = actualHashDescriptor.digest;

    if (expectedHash && actualHash !== expectedHash) {
      throw new StorageIntegrityError(`DENIED: ContentHash Mismatch. Expected ${expectedHash}, got ${actualHash}`);
    }

    return artifact;
  }

  public commit(artifact: ArtifactContract): string {
    // 1. Calculate canonical hash *before* writing
    const hashDescriptor = this.canonicalPipeline.hashCanonical(artifact, "JSON");
    const expectedHash = hashDescriptor.digest;

    // 2. Write blob to raw storage (ledger simulated logic)
    this.rawStorage.write(artifact);

    // 3. Confirm blob is perfectly readable and identically hashed before exposing to runtime
    // Attack 3 Defense: Partial Persistence Failure
    const verifyRef: ArtifactReference = { artifact_id: artifact.artifact_id, artifact_type: artifact.artifact_type };
    try {
      this.resolve(verifyRef, expectedHash);
    } catch (e) {
      throw new StorageIntegrityError("DENIED: Partial Persistence Failure. Written artifact failed readback verification.");
    }

    return expectedHash;
  }
}
