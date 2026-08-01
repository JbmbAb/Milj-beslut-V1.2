import type { MutatedCodeArtifact, EvaluationDatasetArtifact } from "./EvolutionTypes";
import type { ExecutionReport } from "@miljobeslut/mps-runtime";

export interface EvolutionExecutor {
  executeCandidate(
    candidate: MutatedCodeArtifact,
    dataset: EvaluationDatasetArtifact
  ): Promise<ExecutionReport>;
}
