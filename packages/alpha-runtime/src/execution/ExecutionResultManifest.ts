import { HashDescriptor, RegistryReference, ProvenanceGraph } from "../types";

export interface ExecutionStepResult {
  step_id: string;
  capability_ref: RegistryReference;
  success: boolean;
  produced_outputs: RegistryReference[];
  details?: string;
}

export interface ExecutionMetrics {
  total_steps: number;
  successful_steps: number;
  failed_steps: number;
  duration_ms?: number;
}

export interface TrustAssessment {
  verification_hash: HashDescriptor;
  verifier?: RegistryReference;
  checks: {
    identity: "passed" | "failed";
    provenance: "passed" | "failed";
    policy: "passed" | "failed";
    capability: "passed" | "failed";
    schema: "passed" | "failed";
  };
  assessed_at: string;
}

export interface ExecutionResultManifest {
  execution_manifest_ref: RegistryReference;

  execution_identity_hash: HashDescriptor;

  execution_plan_ref: RegistryReference;

  execution_plan_hash: HashDescriptor;

  execution_id: string;

  actor: RegistryReference;

  world_state_root: HashDescriptor;

  outputs: RegistryReference[];

  result: {
    success: boolean;
    completed_at: string;
    step_results: ExecutionStepResult[];
  };

  metrics: ExecutionMetrics;

  trust_assessment: TrustAssessment;

  provenance: ProvenanceGraph;

  created_at: string;

  metadata?: Record<string, unknown>;
}
