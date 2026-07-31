import { RegistryReference, HashDescriptor, ProvenanceGraph } from "../types";

export interface RecoveryPoint {
  snapshot_id: string;
  snapshot_ref: RegistryReference;
  snapshot_hash: HashDescriptor;
  state_root: HashDescriptor;
  created_at: string;
}

export interface RecoveryResult {
  restored: boolean;
  snapshot: RecoveryPoint | null;
  restored_entries: number;
  restored_artifacts: RegistryReference[];
  provenance?: ProvenanceGraph;
  errors: string[];
}
