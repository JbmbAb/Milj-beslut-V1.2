export interface EvolutionRun {
  readonly id: string;
  readonly seed: string;
  readonly searchSpaceHash?: string;
  readonly compilerVersion?: string;
  readonly registryVersion?: string;
  readonly createdAt?: number;
}
