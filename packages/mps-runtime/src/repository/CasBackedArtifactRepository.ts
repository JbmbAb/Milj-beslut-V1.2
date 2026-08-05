import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { ContentHash } from "../../../mps-compliance/src/artifacts/ContentHash.js";
import type { ArtifactReference } from "../../../mps-compliance/src/artifacts/ArtifactReference.js";
import type { ArtifactRepositoryPort } from "../kernel/ExecutionKernel.js";

/**
 * Content-addressed ArtifactRepositoryPort backed by a byte store (Mimers-compatible shape).
 * Wraps CAS get/put without coupling kernel to mps-core serializer graph.
 */
export interface ByteStorageBackend {
  get(id: string): Promise<Uint8Array | null>;
  put(id: string, bytes: Uint8Array): Promise<void>;
  exists(id: string): Promise<boolean>;
}

export class MemoryByteStorageBackend implements ByteStorageBackend {
  private readonly map = new Map<string, Uint8Array>();

  async get(id: string): Promise<Uint8Array | null> {
    return this.map.get(id) ?? null;
  }

  async put(id: string, bytes: Uint8Array): Promise<void> {
    if (this.map.has(id)) {
      const prev = this.map.get(id)!;
      if (Buffer.compare(Buffer.from(prev), Buffer.from(bytes)) !== 0) {
        throw new Error(`WORM violation: ${id}`);
      }
      return;
    }
    this.map.set(id, bytes);
  }

  async exists(id: string): Promise<boolean> {
    return this.map.has(id);
  }
}

/**
 * @deprecated Use MimersByteStorageBackend via createKernelArtifactRepository.
 * Kept for isolated unit tests only — not a product CAS path (no .data/mps-cas).
 */
export class FileByteStorageBackend implements ByteStorageBackend {
  private readonly rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
  }

  private fileFor(id: string): string {
    const safe = createHash("sha256").update(id).digest("hex");
    return path.join(this.rootDir, `${safe}.cas`);
  }

  async get(id: string): Promise<Uint8Array | null> {
    try {
      return await fs.readFile(this.fileFor(id));
    } catch {
      return null;
    }
  }

  async put(id: string, bytes: Uint8Array): Promise<void> {
    await fs.mkdir(this.rootDir, { recursive: true });
    const file = this.fileFor(id);
    try {
      const existing = await fs.readFile(file);
      if (Buffer.compare(existing, Buffer.from(bytes)) !== 0) {
        throw new Error(`WORM violation: ${id}`);
      }
      return;
    } catch (err: any) {
      if (err?.message?.startsWith("WORM")) throw err;
    }
    await fs.writeFile(file, bytes);
  }

  async exists(id: string): Promise<boolean> {
    try {
      await fs.access(this.fileFor(id));
      return true;
    } catch {
      return false;
    }
  }
}

export class CasBackedArtifactRepository implements ArtifactRepositoryPort {
  private readonly backend: ByteStorageBackend;

  constructor(backend: ByteStorageBackend) {
    this.backend = backend;
  }

  async put(artifact: {
    artifact_id: string;
    content_hash: ContentHash;
    body: unknown;
  }): Promise<void> {
    const envelope = {
      artifact_id: artifact.artifact_id,
      content_hash: artifact.content_hash,
      body: artifact.body,
    };
    const bytes = Buffer.from(JSON.stringify(envelope), "utf8");
    await this.backend.put(artifact.artifact_id, bytes);
  }

  async resolve<T>(ref: ArtifactReference): Promise<T> {
    const envelope = await this.resolveEnvelope<T>(ref);
    return envelope.body;
  }

  async resolveEnvelope<T>(ref: ArtifactReference): Promise<{
    artifact_id: string;
    content_hash: ContentHash;
    body: T;
  }> {
    const bytes = await this.backend.get(ref.artifact_id);
    if (!bytes) {
      throw new Error(`Artifact not found: ${ref.artifact_id}`);
    }
    const envelope = JSON.parse(Buffer.from(bytes).toString("utf8")) as {
      artifact_id: string;
      body: T;
      content_hash: ContentHash;
    };
    return envelope;
  }
}
