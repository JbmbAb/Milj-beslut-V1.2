import { HashDescriptor, RegistryReference } from "../../types";

export interface SnapshotIdentity {
  snapshot_id: string;
  snapshot_hash: HashDescriptor;
  parent_snapshot?: RegistryReference;
  state_root: HashDescriptor;
  created_at: string;
}

export interface WorldStateSnapshot {
  identity: SnapshotIdentity;
  entries: RegistryReference[];
  metadata?: Record<string, unknown>;
}
