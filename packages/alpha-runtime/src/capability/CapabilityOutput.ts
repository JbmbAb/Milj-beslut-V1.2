import { RegistryReference } from "../types";

export interface CapabilityArtifactOutput {
  logical_id: string;
  payload: unknown;
  schema_ref?: RegistryReference;
}

export interface CapabilityExecutionMetadata {
  execution_id: string;
  step_id: string;
  seed_used?: string;
  execution_mode: "deterministic" | "best_effort";
}

export interface CapabilityOutput {
  artifacts: CapabilityArtifactOutput[];

  execution: CapabilityExecutionMetadata;

  metadata?: {
    warnings?: string[];
    statistics?: Record<string, number>;
  };
}

import { CapabilityExecutionContext } from "./CapabilityExecutionContext";

export interface CapabilityAdapter {
  capability_id: string;
  execute(context: CapabilityExecutionContext): Promise<CapabilityOutput>;
}

