import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { RawSourceArtifact } from "./RawSourceArtifact";
import { sha256ContentHash } from "../../../mps-runtime/src/kernel/ExecutionKernel";

export interface QuarantineStorage {
  put(artifact: RawSourceArtifact): Promise<void>;
  get(artifactId: string): Promise<RawSourceArtifact | undefined>;
}

export class InMemoryQuarantineStorage implements QuarantineStorage {
  private store = new Map<string, RawSourceArtifact>();

  async put(artifact: RawSourceArtifact): Promise<void> {
    this.store.set(artifact.artifact_id, artifact);
  }

  async get(artifactId: string): Promise<RawSourceArtifact | undefined> {
    return this.store.get(artifactId);
  }
}

export class LokeIngestor {
  constructor(private readonly quarantine: QuarantineStorage) {}

  async ingestFile(filePath: string, authority: string, policy: string): Promise<RawSourceArtifact> {
    const bytes = await readFile(filePath);
    const contentBytesBase64 = bytes.toString("base64");
    
    // Loke records what it saw.
    const payload = {
      filename: filePath.split(/[\\/]/).pop() || "unknown",
      original_path: filePath,
      content_bytes_base64: contentBytesBase64,
      observed_at: new Date().toISOString(),
      authority,
      policy,
    };

    const contentHash = sha256ContentHash(payload);

    const artifact: RawSourceArtifact = {
      artifact_id: `raw-${contentHash.value.substring(0, 8)}`,
      artifact_type: "RAW_SOURCE_ARTIFACT",
      content_hash: contentHash,
      payload,
    };

    // Store in quarantine (NOT IN CAS)
    await this.quarantine.put(artifact);

    return artifact;
  }
}
