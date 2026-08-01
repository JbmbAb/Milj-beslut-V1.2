import type {
  EvolutionSeedArtifact,
  EvaluationDatasetArtifact,
  MutatedCodeArtifact,
  ScoreArtifact,
  EliteSetArtifact,
  EvolutionArtifact,
  SelectionObjectives,
} from "./EvolutionTypes";
import type { MutationSandbox } from "./MutationSandbox";
import type { EvaluationEngine } from "./EvaluationEngine";
import type { SelectionEngine } from "./SelectionEngine";
import type { EvolutionPolicyEngine, EvolutionPromotionDecision } from "./EvolutionPolicy";
import type { PolicyDecisionArtifact } from "@miljobeslut/mps-policy";
import type { ContentIdentityEngine } from "./ContentIdentityEngine";

export class EvolutionController {
  constructor(
    private readonly mutationSandbox: MutationSandbox,
    private readonly evaluationEngine: EvaluationEngine,
    private readonly selectionEngine: SelectionEngine,
    private readonly policyEngine: EvolutionPolicyEngine,
    private readonly identity: ContentIdentityEngine,
  ) {}

  async runGeneration(
    generation: number,
    seed: EvolutionSeedArtifact,
    dataset: EvaluationDatasetArtifact,
    objectives: SelectionObjectives,
    policyDecisions: readonly PolicyDecisionArtifact[],
  ): Promise<{
    evolutionArtifact: EvolutionArtifact;
    promotion: EvolutionPromotionDecision;
    elites: EliteSetArtifact;
    scores: readonly ScoreArtifact[];
    mutations: readonly MutatedCodeArtifact[];
  }> {
    const mutations: MutatedCodeArtifact[] = [];
    const scores: ScoreArtifact[] = [];

    const N = 10;

    for (let i = 0; i < N; i++) {
      const mutation = await this.mutationSandbox.createCandidate(seed, {
        max_change_ratio: 0.2,
        forbidden_regions: [],
        evolve_blocks: [],
      });

      mutations.push(mutation);

      const score = await this.evaluationEngine.evaluate(seed, mutation, dataset);
      scores.push(score);
    }

    const elites = await this.selectionEngine.select(generation, scores, objectives);

    const mutation_hash = this.identity.hashCanonical(
      mutations.map(m => m.mutation_id)
    );
    const score_hash = this.identity.hashCanonical(
      scores.map(s => s.score_id)
    );
    const policy_hash = this.identity.hashCanonical(
      policyDecisions.map(p => p.decision_hash)
    );

    const baseEvolution: Omit<EvolutionArtifact, "evolution_hash"> = {
      schema_version: "evolution.artifact.v1",
      evolution_id: `evo-${generation.toString().padStart(4, "0")}`,
      generation,
      seed_id: seed.seed_id,
      seed_hash: seed.seed_hash,
      mutation_hash,
      score_hash,
      elite_set_id: elites.elite_set_id,
      elite_set_hash: elites.elite_set_hash,
      policy_decisions: policyDecisions,
    };

    const evolution_hash = this.identity.hashCanonical(baseEvolution);
    const evolutionArtifact: EvolutionArtifact = { ...baseEvolution, evolution_hash };

    const promotion = await this.policyEngine.decide(evolutionArtifact);

    return { evolutionArtifact, promotion, elites, scores, mutations };
  }
}
