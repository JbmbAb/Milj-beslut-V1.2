import { ExecutionManifest } from "../../execution/ExecutionManifest";

export function createPfasExecutionManifest(): ExecutionManifest {
  return {
    identity: {
      execution_id: "exec-001",
      execution_version: "1.0",
      identity_scheme: { canonicalization: "JSON-STABLE-V1", hash_algorithm: "sha256-v1" },
      deterministic_seed: "test-seed-123",
      created_at: new Date().toISOString(),
      identity_hash: { algorithm: "sha256-v1", digest: "manifest-hash-123", bit_length: 256 }
    },
    actor: { id: "user1", version: "1", content_hash: { algorithm: "sha256-v1", digest: "actor-hash", bit_length: 256 } },
    world_state: {
      snapshot_ref: { id: "snap1", version: "1", content_hash: { algorithm: "sha256-v1", digest: "snap-hash", bit_length: 256 } },
      state_root: { algorithm: "sha256-v1", digest: "world-root", bit_length: 256 },
      snapshot_schema_version: "1",
      consistency_mode: "strong",
      snapshot_timestamp: new Date().toISOString()
    },
    intent: { purpose: "pfas", domain: "environmental", human_review_required: true },
    artifacts: [],
    policy_ref: { id: "pol1", version: "1", content_hash: { algorithm: "sha256-v1", digest: "pol-hash", bit_length: 256 } },
    capability_refs: [],
    runtime_contract: { determinism_required: true, isolation: "sandbox", execution_class: "regulated" },
    provenance: { root: null, chain: [], merkle_root: { algorithm: "sha256-v1", digest: "prov-root", bit_length: 256 } }
  };
}
