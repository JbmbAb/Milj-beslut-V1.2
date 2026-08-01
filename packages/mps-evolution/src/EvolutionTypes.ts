export interface EvolutionLineage {
  readonly artifact_id: string;
  readonly parent_artifact_id?: string;
  readonly mutation_id?: string;
  readonly generation: number;
}

export interface BehaviorDescriptor {
  readonly accuracy_band: string;
  readonly latency_band: string;
  readonly memory_band: string;
}

export interface MutatedCodeArtifact {
  readonly artifact_id: string;
  readonly content_hash: string;
  readonly code: string;
  readonly lineage: EvolutionLineage;
}

export interface EvaluationDatasetArtifact {
  readonly dataset_id: string;
  readonly records: unknown[];
}

export interface ScoreArtifact {
  readonly artifact_id: string;
  readonly candidate_id: string;
  readonly score: number;
  readonly behavior: BehaviorDescriptor;
  readonly metrics: Record<string, number>;
}

export interface EvolutionArtifact {
  readonly artifact_id: string;
  readonly candidate: MutatedCodeArtifact;
  readonly score: ScoreArtifact;
  readonly is_elite: boolean;
}
