import { RegistryReference, ExecutionManifestIdentity } from '../types';

export interface ExecutionManifest {
  identity: ExecutionManifestIdentity; // The manifest's own content-addressed identity
  execution_id: string;
  planning_context: {
    planner_version: string;
    registry_version: string;
    policy_version: string;
    planning_heuristics_version?: string;
    intent_model_version?: string;
  };
  runtime_context: {
    runtime_version: string;
    manifest_version: string;
  };
  endpoint_context: {
    endpoint_id: string;
    connector_version: string;
  };
  world_state: {
    epoch: number;
    snapshot_id: string;
  };
  feature_flags: Record<string, unknown>;
  identity_schema_ref: RegistryReference;
  created_at: string;
  // Additional fields for full manifest context
  intent_signature: string;
  plan_signature: string;
  registry_snapshot_hash: RegistryReference;
  policy_snapshot_hash: RegistryReference;
  capability_snapshot_hash: RegistryReference;
  input_snapshot_hash: RegistryReference; // Reference to the input artifact
  world_state_snapshot_hash: RegistryReference; // Reference to the world state artifact
  runtime_binary_hash: RegistryReference; // Reference to the runtime binary artifact
  execution_digest: { value: string; algorithm: string; identity_schema_ref: RegistryReference };
  execution_signature: string;
  identity_chain: {
    manifest_identity: RegistryReference;
    plan_identity: RegistryReference;
    runtime_identity: RegistryReference;
  };
  // ... other fields from the original ExecutionManifest
}
