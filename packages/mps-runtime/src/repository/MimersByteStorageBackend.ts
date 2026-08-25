import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { CASRepository } from "@miljobeslut/mimers-brunn-core";
import type { ByteStorageBackend } from "./CasBackedArtifactRepository.js";

type IndexRecord = {
  readonly artifact_id: string;
  readonly hash: string;
};

/**
 * Bridges artifact_id ↔ Mimers content-addressed CAS.
 * Bytes live only in FileCASRepository; id→hash index is a pure lookup table
 * that can be rebuilt by scanning CAS envelopes.
 */
export class MimersByteStorageBackend implements ByteStorageBackend {
  private readonly indexDir: string;

  constructor(
    private readonly cas: CASRepository,
    indexDir: string,
  ) {
    this.indexDir = indexDir;
  }

  private indexPath(id: string): string {
    const safe = createHash("sha256").update(id).digest("hex");
    return path.join(this.indexDir, `${safe}.idx`);
  }

  private async readHash(id: string): Promise<string | null> {
    try {
      const raw = await fs.readFile(this.indexPath(id), "utf8");
      const parsed = JSON.parse(raw) as { hash?: string };
      return parsed.hash ?? null;
    } catch {
      return null;
    }
  }

  private async writeHash(id: string, hash: string): Promise<void> {
    await fs.mkdir(this.indexDir, { recursive: true });
    const record: IndexRecord = { artifact_id: id, hash };
    await fs.writeFile(this.indexPath(id), JSON.stringify(record), "utf8");
  }

  async get(id: string): Promise<Uint8Array | null> {
    const hash = await this.readHash(id);
    if (!hash) return null;
    return this.cas.getBytes(hash, { verifyHash: true });
  }

  async put(id: string, bytes: Uint8Array): Promise<void> {
    const existingHash = await this.readHash(id);
    if (existingHash) {
      const existing = await this.cas.getBytes(existingHash);
      if (existing && Buffer.compare(Buffer.from(existing), Buffer.from(bytes)) !== 0) {
        throw new Error(`WORM violation: ${id}`);
      }
      return;
    }
    const result = await this.cas.putBytes(bytes);
    await this.writeHash(id, result.hash);
  }

  async exists(id: string): Promise<boolean> {
    const hash = await this.readHash(id);
    if (!hash) return false;
    return this.cas.exists(hash);
  }

  /** Content-address digest for an artifact_id (index lookup only). */
  async resolveContentAddress(id: string): Promise<string | null> {
    return this.readHash(id);
  }

  /**
   * Rebuild id→hash index from CAS object envelopes.
   * Safe if index is deleted; only envelopes with artifact_id are indexed.
   */
  async rebuildIndexFromCas(): Promise<{ rebuilt: number; skipped: number }> {
    await fs.rm(this.indexDir, { recursive: true, force: true });
    await fs.mkdir(this.indexDir, { recursive: true });

    let rebuilt = 0;
    let skipped = 0;

    for await (const digest of this.cas.streamObjectDigests()) {
      const bytes = await this.cas.getBytes(digest);
      if (!bytes) {
        skipped += 1;
        continue;
      }
      let artifactId: string | undefined;
      try {
        const parsed = JSON.parse(Buffer.from(bytes).toString("utf8")) as {
          artifact_id?: unknown;
        };
        if (typeof parsed.artifact_id === "string" && parsed.artifact_id.length > 0) {
          artifactId = parsed.artifact_id;
        }
      } catch {
        skipped += 1;
        continue;
      }
      if (!artifactId) {
        skipped += 1;
        continue;
      }
      await this.writeHash(artifactId, digest);
      rebuilt += 1;
    }

    return { rebuilt, skipped };
  }
}
