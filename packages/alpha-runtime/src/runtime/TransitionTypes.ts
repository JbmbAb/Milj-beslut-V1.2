import { RegistryReference } from "../types";

export type LifecycleOperation =
  | "created"
  | "mutated"
  | "promoted"
  | "deprecated"
  | "restored";

export interface ExecutionState {
  id: string;
  status:
    | "pending"
    | "admitted"
    | "running"
    | "completed"
    | "failed"
    | "deprecated";
  artifact_ref?: RegistryReference;
  metadata?: Record<string, unknown>;
}

export interface TransitionEvent {
  transition_id: string;
  from_state: ExecutionState["status"];
  to_state: ExecutionState["status"];
  operation: LifecycleOperation;
  artifact_ref: RegistryReference;
  actor: RegistryReference;
  policy_ref?: RegistryReference;
  guard_result: Record<string, boolean>;
  action_result: Record<string, unknown>;
  timestamp: string;
}

export interface TransitionResult {
  allowed: boolean;
  new_state: ExecutionState;
  provenance_operation: LifecycleOperation;
  errors: string[];
}
