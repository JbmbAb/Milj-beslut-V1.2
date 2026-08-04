import { ArtifactContract } from "./ArtifactContract";
import { ArtifactReference } from "./ArtifactReference";

/**
 * AuditRenderSnapshotArtifact
 * 
 * Formalizes the bridge between the backend audit projection (Phase 20)
 * and the frontend presentation layer (Phase 21). This artifact proves
 * exactly what graph state was yielded for rendering.
 */
export interface AuditRenderSnapshotArtifact extends ArtifactContract {
  readonly artifact_type: "audit_render_snapshot";
  readonly release_hash: string;
  readonly graph_hash: string;
  readonly layout_hash: string;
  readonly node_count: number;
  readonly edge_count: number;
  readonly generated_from: ArtifactReference;
}
