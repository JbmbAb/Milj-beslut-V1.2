import { ArtifactReference } from "../artifacts/ArtifactReference";

export interface AuditNode {
  readonly artifact_ref: ArtifactReference;
  readonly artifact_type: string;
  readonly content_hash: string;
}

export interface AuditEdge {
  readonly source_ref: ArtifactReference;
  readonly target_ref: ArtifactReference;
  readonly relation_type: string;
  // Edges must carry evidence of how this relation was formed
  readonly evidence_ref: ArtifactReference; 
}

/**
 * CanonicalGraphProjection
 *
 * Represents a pure, reproducible proof path without layout or presentation state.
 */
export interface CanonicalGraphProjection {
  readonly release_hash: string;
  readonly root_node: ArtifactReference;
  readonly nodes: readonly AuditNode[];
  readonly edges: readonly AuditEdge[];
}
