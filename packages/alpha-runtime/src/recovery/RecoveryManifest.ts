import { RegistryReference, HashDescriptor, ProvenanceGraph } from "../types";

export interface RecoveryManifest {
  recovery_id: string;
  recovery_actor: RegistryReference;
  source_snapshot: RegistryReference;
  state_root: HashDescriptor;
  restored_artifacts: RegistryReference[];
  verifier_version: string;
  created_at: string;
  provenance: ProvenanceGraph;
  metadata?: {
    recovery_reason?: string;
    trigger_type?: "manual" | "scheduled" | "automatic";
    previous_world_state_root?: HashDescriptor;
    restored_world_state_root?: HashDescriptor;
  };
}
