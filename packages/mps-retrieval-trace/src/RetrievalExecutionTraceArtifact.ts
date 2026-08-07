import { ArtifactReference } from '../../mps-retrieval-governance/src/ArtifactReader';

export interface TraceMetadata {
  executed_at: string;
  duration_ms: number;
  estimated_cost: number;
  token_estimate: number;
  node_id: string;
}

export interface RetrievalExecutionTraceArtifact {
  trace_hash: string;
  
  // Identity fields
  query_hash: string;
  policy_version: string;
  artifact_snapshot_ref: string;
  selected_artifact_refs: ArtifactReference[];

  // Metadata fields
  metadata: TraceMetadata;
}
