import type {
  MutatedCodeArtifact,
  EvaluationDatasetArtifact,
} from "./EvolutionTypes";
import type { ExecutionReport } from "@miljobeslut/mps-runtime";

/**
 * EvolutionExecutor är kontrollplanet ovanpå PipelineRuntime.
 * Den exponerar bara ett experimentellt API, inte en ny runtime.
 */
export interface EvolutionExecutor {
  executeCandidate(
    candidate: MutatedCodeArtifact,
    dataset: EvaluationDatasetArtifact
  ): Promise<ExecutionReport>;
}
