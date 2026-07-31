import { RegistryReference, HashDescriptor } from "../types";

export type WorldStateStatus = "active" | "inactive" | "deprecated";

export interface WorldStateEntry {
  entity_id: string;
  artifact_ref: RegistryReference;
  parent_ref?: RegistryReference;
  state: WorldStateStatus;
  version: string;
  provenance_ref?: RegistryReference;
  created_at: string;
  updated_at: string;
  metadata?: Record<string, unknown>;
}

export interface WorldStateApplyResult {
  applied: boolean;
  idempotent?: boolean;
  previous?: WorldStateEntry;
  current?: WorldStateEntry;
  errors: string[];
}

export interface WorldStateRootCalculator {
  calculateRoot(): Promise<HashDescriptor>;
}
