import type { ReplayResult } from "@miljobeslut/mps-replay";
import type { PolicyDecisionArtifact } from "@miljobeslut/mps-policy";

export interface EvolutionSeedArtifact {
  readonly schema_version: "evolution.seed.v1";
  readonly seed_id: string;
  readonly seed_hash: string;
  readonly code: Uint8Array;
  readonly metadata: {
    readonly description?: string;
    readonly domain?: string;
    readonly pipeline_id?: string;
    readonly created_at: string;
  };
}

export interface MutatedCodeArtifact {
  readonly schema_version: "evolution.mutation.v1";
  readonly mutation_id: string;
  readonly parent_seed_id: string;
  readonly code_hash: string;
  readonly code: Uint8Array;
  readonly mutation_metadata: {
    readonly model: string;
    readonly model_version: string;
    readonly model_digest: string;
    readonly temperature: number;
    readonly top_p?: number;
    readonly prompt_hash: string;
    readonly system_prompt_hash?: string;
    readonly changed_regions: readonly string[];
    readonly mutation_type: "structural" | "parametric" | "hybrid";
    readonly created_at: string;
  };
}

export interface EvaluationDatasetArtifact {
  readonly dataset_id: string;
  readonly dataset_hash: string;
  readonly description?: string;
}

export interface ScoreArtifact {
  readonly schema_version: "evolution.score.v1";
  readonly score_id: string;
  readonly score_hash: string;
  readonly mutation_id: string;
  readonly seed_id: string;
  readonly dataset_id: string;
  readonly metrics: {
    readonly runtime_ms: number;
    readonly accuracy: number;
    readonly memory_mb: number;
    readonly custom: Record<string, number>;
  };
  readonly replay_proof: ReplayResult;
  readonly evaluated_at: string;
}

export interface SelectionObjectives {
  readonly maximize: readonly string[];
  readonly minimize: readonly string[];
}

export interface BehaviorDescriptor {
  readonly accuracy_band: string;
  readonly latency_band: string;
  readonly memory_band: string;
}

export interface EliteCell {
  readonly descriptor: BehaviorDescriptor;
  readonly candidate?: ScoreArtifact;
}

export interface EliteSetArtifact {
  readonly schema_version: "evolution.elites.v1";
  readonly elite_set_id: string;
  readonly elite_set_hash: string;
  readonly generation: number;
  readonly cells: readonly EliteCell[];
  readonly objectives: SelectionObjectives;
}

export interface EvolutionArtifact {
  readonly schema_version: "evolution.artifact.v1";
  readonly evolution_id: string;
  readonly generation: number;
  readonly seed_id: string;
  readonly seed_hash: string;
  readonly mutation_hash: string;
  readonly score_hash: string;
  readonly elite_set_id: string;
  readonly elite_set_hash: string;
  readonly policy_decisions: readonly PolicyDecisionArtifact[];
  readonly evolution_hash: string;
}

export interface EvolutionAuditRecord {
  readonly schema_version: "evolution.audit.v1";
  readonly evolution_id: string;
  readonly generation: number;
  readonly seed_hash: string;
  readonly mutation_hash: string;
  readonly score_hash: string;
  readonly elite_set_hash: string;
  readonly policy_hash: string;
  readonly timestamp: string;
  readonly audit_hash: string;
  readonly parent?: {
    readonly evolution_id: string;
    readonly audit_hash: string;
  };
}

export interface EvolutionLineage {
  readonly artifact_id: string;
  readonly parent_artifact_id?: string;
  readonly mutation_id?: string;
  readonly generation: number;
}
