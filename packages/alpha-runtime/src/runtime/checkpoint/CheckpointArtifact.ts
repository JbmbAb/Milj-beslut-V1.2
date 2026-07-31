import { HashDescriptor } from "../../types/HashDescriptor";
import { RegistryReference } from "../../types";

export interface CheckpointArtifactPayload {
  readonly execution_identity_hash: HashDescriptor;
  readonly execution_plan_hash: HashDescriptor;
  readonly dependency_graph_hash: HashDescriptor;
  readonly deterministic_seed: string;
  readonly completed_steps: readonly string[];
  readonly produced_outputs: readonly RegistryReference[];
  readonly replay_fingerprint: HashDescriptor;
  readonly created_at_iso: string;
}

export interface CheckpointArtifact {
  readonly identity_hash: HashDescriptor;
  readonly payload: CheckpointArtifactPayload;
}
