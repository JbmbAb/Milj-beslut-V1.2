import type {
  ScoreArtifact,
  SelectionObjectives,
  BehaviorDescriptor,
  EliteCell,
  EliteSetArtifact,
} from "./EvolutionTypes";
import type { ContentIdentityEngine } from "./ContentIdentityEngine";

function band(value: number, thresholds: number[]): string {
  if (value <= thresholds[0]) return "low";
  if (value <= thresholds[1]) return "mid";
  return "high";
}

export class SelectionEngine {
  constructor(private readonly identity: ContentIdentityEngine) {}

  private describe(score: ScoreArtifact): BehaviorDescriptor {
    return {
      accuracy_band: band(score.metrics.accuracy, [0.8, 0.95]),
      latency_band: band(score.metrics.runtime_ms, [50, 200]),
      memory_band: band(score.metrics.memory_mb, [64, 256]),
    };
  }

  async select(
    generation: number,
    population: readonly ScoreArtifact[],
    objectives: SelectionObjectives
  ): Promise<EliteSetArtifact> {
    const cellsMap = new Map<string, EliteCell>();

    for (const candidate of population) {
      const descriptor = this.describe(candidate);
      const key = JSON.stringify(descriptor);
      const existing = cellsMap.get(key);

      if (!existing || candidate.metrics.accuracy > existing.candidate!.metrics.accuracy) {
        cellsMap.set(key, { descriptor, candidate });
      }
    }

    const cells = Array.from(cellsMap.values());
    const baseElites: Omit<EliteSetArtifact, "elite_set_id" | "elite_set_hash"> = {
      schema_version: "evolution.elites.v1",
      generation,
      cells,
      objectives,
    };

    const elite_set_hash = this.identity.hashCanonical(baseElites);

    return {
      ...baseElites,
      elite_set_hash,
      elite_set_id: `elites-${generation.toString().padStart(4, "0")}`,
    };
  }
}
