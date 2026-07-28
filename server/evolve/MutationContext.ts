export interface MutationContext {
  readonly experimentId: string;
  readonly seed: string;
  readonly generation: number;
  readonly candidateIndex: number;
}
