import type {
  MutatedCodeArtifact,
  EvaluationDatasetArtifact,
  ScoreArtifact,
} from "./EvolutionTypes";
import type { EvolutionExecutor } from "./EvolutionExecutor";
import type { SelectionEngine } from "./MapElitesArchive";
import type { EvolutionPolicyEngine } from "./EvolutionPolicy";
import type { ExecutionReport } from "@miljobeslut/mps-runtime";

export interface EvaluationEngine {
  evaluate(report: ExecutionReport): Promise<ScoreArtifact>;
}

export class EvolutionController {
  constructor(
    private readonly executor: EvolutionExecutor,
    private readonly evaluator: EvaluationEngine,
    private readonly selection: SelectionEngine,
    private readonly policyEngine: EvolutionPolicyEngine
  ) {}

  async processCandidate(
    candidate: MutatedCodeArtifact,
    dataset: EvaluationDatasetArtifact
  ): Promise<void> {
    // 1. Execute candidate in sandbox
    const report = await this.executor.executeCandidate(candidate, dataset);

    // 2. Evaluate performance and behavior
    const score = await this.evaluator.evaluate(report);

    // 3. Check Evolution Policy
    const allowed = this.policyEngine.evaluate(candidate, score);
    if (!allowed) {
      return; // Drop candidate
    }

    // 4. MAP-Elites Selection
    await this.selection.select(score);
  }
}
