import { RetrievalExecutionTraceArtifact, TraceMetadata } from './RetrievalExecutionTraceArtifact';
import { calculateRetrievalTraceIdentity } from './RetrievalTraceIdentity';
import { ArtifactReference } from '../../mps-retrieval-governance/src/ArtifactReader';

export class RetrievalTraceBuilder {
  private query_hash?: string;
  private policy_version?: string;
  private artifact_snapshot_ref?: string;
  private selected_artifact_refs: ArtifactReference[] = [];
  
  private metadata: Partial<TraceMetadata> = {};

  setQueryHash(hash: string) { this.query_hash = hash; return this; }
  setPolicyVersion(v: string) { this.policy_version = v; return this; }
  setSnapshotRef(ref: string) { this.artifact_snapshot_ref = ref; return this; }
  setArtifactRefs(refs: ArtifactReference[]) { this.selected_artifact_refs = refs; return this; }
  setMetadata(meta: TraceMetadata) { this.metadata = meta; return this; }

  build(): RetrievalExecutionTraceArtifact {
    if (!this.query_hash || !this.policy_version || !this.artifact_snapshot_ref) {
      throw new Error("Missing required identity fields for trace");
    }

    const trace_hash = calculateRetrievalTraceIdentity(
      this.query_hash,
      this.policy_version,
      this.artifact_snapshot_ref,
      this.selected_artifact_refs
    );

    return {
      trace_hash,
      query_hash: this.query_hash,
      policy_version: this.policy_version,
      artifact_snapshot_ref: this.artifact_snapshot_ref,
      selected_artifact_refs: this.selected_artifact_refs,
      metadata: this.metadata as TraceMetadata
    };
  }
}
