import type { ContentHash } from "../../../mps-compliance/src/artifacts/ContentHash.js";
import type { ArtifactReference } from "../../../mps-compliance/src/artifacts/ArtifactReference.js";
import type { ArtifactRepositoryPort } from "../kernel/ExecutionKernel.js";
import {
  CasArtifactResolver,
  type ArtifactResolverPort,
} from "../mimers/ArtifactResolver.js";

/**
 * Content-addressed ArtifactRepositoryPort backed by a byte store (Mimers-compatible shape).
 * Put writes envelopes; resolve delegates to ArtifactResolver → CAS.
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

export class CasBackedArtifactRepository implements ArtifactRepositoryPort {
  private readonly backend: ByteStorageBackend;
  readonly resolver: ArtifactResolverPort;

  constructor(backend: ByteStorageBackend) {
    this.backend = backend;
    this.resolver = new CasArtifactResolver(backend);
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
    return this.resolver.resolve<T>(ref);
  }

  async resolveEnvelope<T>(ref: ArtifactReference): Promise<{
    artifact_id: string;
    content_hash: ContentHash;
    body: T;
  }> {
    return this.resolver.resolveEnvelope<T>(ref);
  }
}
