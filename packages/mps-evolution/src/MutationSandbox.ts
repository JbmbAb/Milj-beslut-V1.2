import type { EvolutionSeedArtifact, MutatedCodeArtifact } from "./EvolutionTypes";

export interface MutationConstraints {
  readonly max_change_ratio: number;
  readonly forbidden_regions: readonly string[];
  readonly evolve_blocks: readonly string[];
}

export interface MutationEngine {
  mutate(
    seed: EvolutionSeedArtifact,
    constraints: MutationConstraints
  ): Promise<MutatedCodeArtifact>;
}

export class MutationSandbox {
  constructor(private readonly engine: MutationEngine) {}

  async createCandidate(
    seed: EvolutionSeedArtifact,
    constraints: MutationConstraints
  ): Promise<MutatedCodeArtifact> {
    return this.engine.mutate(seed, constraints);
  }
}
