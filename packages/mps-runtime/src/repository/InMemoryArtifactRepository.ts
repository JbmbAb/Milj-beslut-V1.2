import type { ContentHash } from "../../../mps-compliance/src/artifacts/ContentHash.js";
import type { ArtifactReference } from "../../../mps-compliance/src/artifacts/ArtifactReference.js";
import type { ArtifactRepositoryPort } from "../kernel/ExecutionKernel.js";
import type { ArtifactCatalogPort } from "./ArtifactCatalog.js";

/**
 * In-memory ArtifactRepository for kernel tests and early strangler.
 * Production wiring uses Mimers/CAS-backed store (Fas 1).
 */
export class InMemoryArtifactRepository implements ArtifactRepositoryPort, ArtifactCatalogPort {
  private readonly store = new Map<string, { content_hash: ContentHash; body: unknown }>();

  async put(artifact: {
    artifact_id: string;
    content_hash: ContentHash;
    body: unknown;
  }): Promise<void> {
    const existing = this.store.get(artifact.artifact_id);
    if (existing && existing.content_hash.value !== artifact.content_hash.value) {
      throw new Error(`WORM violation: ${artifact.artifact_id}`);
    }
    this.store.set(artifact.artifact_id, {
      content_hash: artifact.content_hash,
      body: artifact.body,
    });
  }

  async resolve<T>(ref: ArtifactReference): Promise<T> {
    const hit = this.store.get(ref.artifact_id);
    if (!hit) {
      throw new Error(`Artifact not found: ${ref.artifact_id}`);
    }
    return hit.body as T;
  }

  async listArtifactIds(): Promise<readonly string[]> {
    return [...this.store.keys()];
  }
}
