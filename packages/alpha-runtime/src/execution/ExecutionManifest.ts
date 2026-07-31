import { HashDescriptor, RegistryReference, ProvenanceGraph } from "../types";

export interface ExecutionIdentityScheme {
  canonicalization: "JSON-STABLE-V1" | "RFC8785-JCS";
  hash_algorithm: "sha256-v1";
}

export interface ExecutionIdentity {
  execution_id: string;
  execution_version: string;
  identity_scheme: ExecutionIdentityScheme;
  deterministic_seed?: string;
  created_at: string;
  identity_hash: HashDescriptor;
}

export interface WorldStateBinding {
  snapshot_ref: RegistryReference;
  state_root: HashDescriptor;
  snapshot_schema_version: string;
  consistency_mode: "strong" | "snapshot" | "eventual";
  snapshot_timestamp: string;
}

export interface ExecutionIntent {
  purpose: string;
  domain: string;
  human_review_required: boolean;
}

export interface RuntimeContract {
  determinism_required: boolean;
  isolation: "sandbox" | "shared";
  execution_class: "regulated" | "experimental";
  latency_budget_ms?: {
    p95: number;
  };
}

export interface ExecutionManifest {
  identity: ExecutionIdentity;

  actor: RegistryReference;

  world_state: WorldStateBinding;

  intent: ExecutionIntent;

  artifacts: RegistryReference[];

  policy_ref: RegistryReference;

  capability_refs: RegistryReference[];

  runtime_contract: RuntimeContract;

  recovery_source?: RegistryReference;

  provenance: ProvenanceGraph;

  metadata?: Record<string, unknown>;
}
