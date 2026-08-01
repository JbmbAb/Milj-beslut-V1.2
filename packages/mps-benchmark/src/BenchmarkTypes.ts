import type {
  EvaluationDatasetArtifact,
  ScoreArtifact,
} from "@miljobeslut/mps-evolution";

export interface BenchmarkSuite {
  readonly benchmark_id: string;
  readonly dataset: EvaluationDatasetArtifact;
  readonly baseline_score?: ScoreArtifact;
  readonly target_accuracy_threshold: number;
}
