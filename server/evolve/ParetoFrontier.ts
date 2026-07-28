export interface ObjectiveVector {
  readonly quality: number;
  readonly latency: number;
  readonly cost: number;
  readonly error: number;
}

export interface FrontierCandidate {
  readonly id: string;
  readonly executionHash: string;
  readonly artifactId: string;
  readonly objectives: ObjectiveVector;
  readonly fitness: number;
  readonly sourceExperimentId?: string;
  readonly pipelineDefinitionHash?: string;
}

export class ParetoFrontier {
  private candidates: FrontierCandidate[] = [];

  add(candidate: FrontierCandidate): void {
    this.candidates = this.candidates.filter((existing) => !dominates(candidate, existing));

    if (!this.candidates.some((existing) => dominates(existing, candidate))) {
      this.candidates.push(candidate);
    }
  }

  list(): readonly FrontierCandidate[] {
    return [...this.candidates];
  }
}

export function dominates(a: FrontierCandidate, b: FrontierCandidate): boolean {
  const betterOrEqual =
    a.objectives.quality >= b.objectives.quality &&
    a.objectives.latency <= b.objectives.latency &&
    a.objectives.cost <= b.objectives.cost &&
    a.objectives.error <= b.objectives.error;

  const strictlyBetter =
    a.objectives.quality > b.objectives.quality ||
    a.objectives.latency < b.objectives.latency ||
    a.objectives.cost < b.objectives.cost ||
    a.objectives.error < b.objectives.error;

  return betterOrEqual && strictlyBetter;
}
