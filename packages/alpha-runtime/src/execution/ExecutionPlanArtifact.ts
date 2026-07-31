import { HashDescriptor, RegistryReference } from "../types";

export interface ExecutionStep {
  step_id: string;
  capability_ref: RegistryReference;
  inputs: RegistryReference[];
  expected_outputs?: RegistryReference[];
  description?: string;
}

export interface ExecutionDependency {
  from: string; // step_id
  to: string;   // step_id
  type: "data" | "control" | "policy";
}

export interface ExecutionPlanIdentityEnvelope {
  plan_id: string;
  execution_manifest_ref: RegistryReference;
  execution_identity_hash: HashDescriptor;
  steps: ExecutionStep[];
  dependencies: ExecutionDependency[];
  planner: RegistryReference;
  planner_version: string;
  ordering_strategy: "topological";
  created_at: string;
}

export interface ExecutionPlanArtifact {
  plan_id: string;

  execution_manifest_ref: RegistryReference;

  execution_identity_hash: HashDescriptor;

  steps: ExecutionStep[];

  dependencies: ExecutionDependency[];

  planner: RegistryReference;

  planner_version: string;

  ordering_strategy: "topological";

  created_at: string;

  // Content-addressed identity of the plan (hash of unsigned plan envelope)
  content_hash: HashDescriptor;

  metadata?: Record<string, unknown>;
}
