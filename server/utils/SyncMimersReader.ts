import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { ArtifactReader } from "../../packages/mps-compliance/src/audit/ProofPathResolver.js";
import type { ArtifactReference } from "../../packages/mps-compliance/src/artifacts/ArtifactReference.js";
import type { ArtifactContract } from "../../packages/mps-compliance/src/artifacts/ArtifactContract.js";

/**
 * Synchronous reader for the Mimers CAS.
 * Required by ProofPathResolver which builds the 10k node graph iteratively and synchronously.
 * Reads directly from the WORM storage layout defined by FileCASRepository and MimersByteStorageBackend.
 */
export class SyncMimersReader implements ArtifactReader {
  constructor(private readonly mimersRoot: string) {}

  read(ref: ArtifactReference): ArtifactContract | null {
    const indexDir = path.join(this.mimersRoot, "cas", "artifact-id-index");
    const safe = crypto.createHash("sha256").update(ref.artifact_id).digest("hex");
    const idxPath = path.join(indexDir, `${safe}.idx`);

    let hash: string | undefined;
    try {
      const idxRaw = fs.readFileSync(idxPath, "utf8");
      const parsed = JSON.parse(idxRaw) as { hash?: string };
      hash = parsed.hash;
    } catch {
      return null; // Not indexed or missing
    }

    if (!hash) return null;

    const casPath = path.join(this.mimersRoot, "cas", hash);
    try {
      const bytes = fs.readFileSync(casPath);
      const expected = hash.startsWith("sha256:") ? hash.slice("sha256:".length) : hash;
      const computed = crypto.createHash("sha256").update(bytes).digest("hex");
      if (computed !== expected) {
        throw new Error(`CASIntegrityError: stored bytes do not match ${hash}`);
      }
      const envelope = JSON.parse(bytes.toString("utf8")) as { body?: ArtifactContract };
      return envelope.body ?? null;
    } catch {
      return null;
    }
  }
}
