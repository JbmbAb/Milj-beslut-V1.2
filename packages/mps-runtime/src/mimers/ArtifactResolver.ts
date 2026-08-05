/**
 * Resolver seam — ArtifactRepository → Resolver → CAS (Epoch II §2.4).
 * Read-by-ref only; put stays on ArtifactRepository / ByteStorageBackend.
 */

import type { ContentHash } from "../../../mps-compliance/src/artifacts/ContentHash.js";
import type { ArtifactReference } from "../../../mps-compliance/src/artifacts/ArtifactReference.js";

/** Minimal read port — avoids circular import with CasBackedArtifactRepository. */
export type ResolverByteStore = {
  get(id: string): Promise<Uint8Array | null>;
};

export type ArtifactEnvelope<T = unknown> = {
  readonly artifact_id: string;
  readonly content_hash: ContentHash;
  readonly body: T;
};

export interface ArtifactResolverPort {
  resolve<T>(ref: ArtifactReference): Promise<T>;
  resolveEnvelope<T>(ref: ArtifactReference): Promise<ArtifactEnvelope<T>>;
}

/**
 * Resolves artifact refs via content-addressed byte store (Mimers or memory).
 */
export class CasArtifactResolver implements ArtifactResolverPort {
  constructor(private readonly backend: ResolverByteStore) {}

  async resolve<T>(ref: ArtifactReference): Promise<T> {
    const envelope = await this.resolveEnvelope<T>(ref);
    return envelope.body;
  }

  async resolveEnvelope<T>(ref: ArtifactReference): Promise<ArtifactEnvelope<T>> {
    const bytes = await this.backend.get(ref.artifact_id);
    if (!bytes) {
      throw new Error(`Artifact not found: ${ref.artifact_id}`);
    }
    const envelope = JSON.parse(Buffer.from(bytes).toString("utf8")) as {
      artifact_id: string;
      body: T;
      content_hash: ContentHash;
    };
    return {
      artifact_id: envelope.artifact_id,
      content_hash: envelope.content_hash,
      body: envelope.body,
    };
  }
}
