import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import type { CASRepository } from "@miljobeslut/mimers-brunn-core";
import type { ByteStorageBackend } from "./CasBackedArtifactRepository.js";

type IndexRecord = {
  readonly artifact_id: string;
  readonly hash: string;
};

export const MIMERS_ARTIFACT_INDEX_READ_FAILED = "MIMERS_ARTIFACT_INDEX_READ_FAILED" as const;

/**
 * U30-A: an id->hash index entry EXISTS but could not be read or parsed. This is a storage
 * fault, never "artifact not found": only a genuinely absent entry (ENOENT) means not found.
 * Collapsing the two made a broken CAS read look like a missing artifact (in the geometry chain,
 * the one case where a centroid may be derived) and let put() overwrite the unreadable entry.
 */
export class MimersArtifactIndexReadError extends Error {
  readonly code = MIMERS_ARTIFACT_INDEX_READ_FAILED;

  constructor(
    readonly artifactId: string,
    readonly indexPath: string,
    readonly reason: "IO" | "MALFORMED",
    detail: string,
    options?: { cause?: unknown },
  ) {
    super(
      `${MIMERS_ARTIFACT_INDEX_READ_FAILED}: the id->hash index entry for artifact '${artifactId}' ` +
        `exists but could not be read (${reason}: ${detail}); this is a storage fault, not a missing artifact`,
      options,
    );
    this.name = "MimersArtifactIndexReadError";
  }
}

export const MIMERS_ARTIFACT_OBJECT_MISSING = "MIMERS_ARTIFACT_OBJECT_MISSING" as const;

/**
 * ADV-1 rest / OD-R2: the id->hash index entry EXISTS and names a CAS object that is not in the CAS.
 * The artifact was stored -- its index entry is written only after its object -- so the bytes being
 * gone (lost, deleted, quarantined, a CAS root mixed up underneath the index) is a storage integrity
 * fault, never "artifact not found". Reading it as "not found" let the geometry chain treat a lost
 * current point as a determined MISSING verdict, and let put() return silently over the entry.
 */
export class MimersArtifactObjectMissingError extends Error {
  readonly code = MIMERS_ARTIFACT_OBJECT_MISSING;

  constructor(
    readonly artifactId: string,
    readonly hash: string,
    readonly operation: "get" | "exists" | "put",
  ) {
    super(
      `${MIMERS_ARTIFACT_OBJECT_MISSING}: the id->hash index entry for artifact '${artifactId}' names CAS object ` +
        `'${hash}', which is not in the CAS (${operation}); this is a storage integrity fault, not a missing artifact`,
    );
    this.name = "MimersArtifactObjectMissingError";
  }
}

function isEnoent(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

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

  /**
   * `null` ONLY when the index entry does not exist (ENOENT): the artifact is not stored.
   * An entry that exists but cannot be read or parsed throws `MimersArtifactIndexReadError`.
   */
  private async readHash(id: string): Promise<string | null> {
    const indexPath = this.indexPath(id);
    let raw: string;
    try {
      raw = await fs.readFile(indexPath, "utf8");
    } catch (error) {
      if (isEnoent(error)) return null;
      const detail = error instanceof Error ? error.message : String(error);
      throw new MimersArtifactIndexReadError(id, indexPath, "IO", detail, { cause: error });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new MimersArtifactIndexReadError(id, indexPath, "MALFORMED", "entry is not valid JSON", {
        cause: error,
      });
    }
    const hash =
      typeof parsed === "object" && parsed !== null ? (parsed as { hash?: unknown }).hash : undefined;
    if (typeof hash !== "string" || hash.length === 0) {
      throw new MimersArtifactIndexReadError(id, indexPath, "MALFORMED", "entry carries no hash");
    }
    return hash;
  }

  /** Write-then-rename, so a concurrent reader never sees a torn (empty/partial) entry. */
  private async writeHash(id: string, hash: string): Promise<void> {
    await fs.mkdir(this.indexDir, { recursive: true });
    const record: IndexRecord = { artifact_id: id, hash };
    const target = this.indexPath(id);
    const temp = `${target}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
    await fs.writeFile(temp, JSON.stringify(record), "utf8");
    try {
      await fs.rename(temp, target);
    } catch (error) {
      await fs.rm(temp, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  /**
   * `null` ONLY when the artifact was never indexed. An index entry whose CAS object is gone throws
   * `MimersArtifactObjectMissingError` (ADV-1 rest): it was stored, so it is not "not found".
   */
  async get(id: string): Promise<Uint8Array | null> {
    const hash = await this.readHash(id);
    if (!hash) return null;
    const bytes = await this.cas.getBytes(hash, { verifyHash: true });
    if (bytes === null) throw new MimersArtifactObjectMissingError(id, hash, "get");
    return bytes;
  }

  async put(id: string, bytes: Uint8Array): Promise<void> {
    const existingHash = await this.readHash(id);
    if (existingHash) {
      const existing = await this.cas.getBytes(existingHash);
      // ADV-1 rest: an indexed id whose object is gone is not "already stored" -- fail closed instead
      // of returning silently over it (the artifact would stay unreadable). No silent repair either.
      if (existing === null) throw new MimersArtifactObjectMissingError(id, existingHash, "put");
      if (Buffer.compare(Buffer.from(existing), Buffer.from(bytes)) !== 0) {
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
    if (await this.cas.exists(hash)) return true;
    throw new MimersArtifactObjectMissingError(id, hash, "exists");
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
