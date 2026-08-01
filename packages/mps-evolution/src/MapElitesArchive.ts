import type { EvolutionArtifact, ScoreArtifact } from "./EvolutionTypes";

export interface SelectionEngine {
  select(score: ScoreArtifact): Promise<EvolutionArtifact>;
}

export class MapElitesArchive implements SelectionEngine {
  private elites = new Map<string, EvolutionArtifact>();

  private getCellKey(behavior: ScoreArtifact["behavior"]): string {
    return `${behavior.accuracy_band}|${behavior.latency_band}|${behavior.memory_band}`;
  }

  async select(score: ScoreArtifact): Promise<EvolutionArtifact> {
    const key = this.getCellKey(score.behavior);
    const existing = this.elites.get(key);

    let is_elite = false;

    if (!existing || score.score > existing.score.score) {
      is_elite = true;
    }

    const artifact: EvolutionArtifact = {
      artifact_id: `evo-${score.candidate_id}`,
      candidate: {
        artifact_id: score.candidate_id,
        content_hash: "hash",
        code: "code",
        lineage: { artifact_id: score.candidate_id, generation: 1 },
      },
      score,
      is_elite,
    };

    if (is_elite) {
      this.elites.set(key, artifact);
    }

    return artifact;
  }

  getElites(): EvolutionArtifact[] {
    return Array.from(this.elites.values());
  }
}
