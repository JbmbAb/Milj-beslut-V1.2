import { describe, expect, it } from "vitest";
import { EvolutionController, DefaultEvolutionPolicyEngine, MapElitesArchive } from "../index";
import type { EvolutionExecutor, EvaluationEngine } from "../index";
import type { MutatedCodeArtifact, EvaluationDatasetArtifact, ScoreArtifact } from "../index";
import type { ExecutionReport } from "@miljobeslut/mps-runtime";

class MockExecutor implements EvolutionExecutor {
  async executeCandidate(_candidate: MutatedCodeArtifact, _dataset: EvaluationDatasetArtifact): Promise<ExecutionReport> {
    return {} as ExecutionReport;
  }
}

class MockEvaluator implements EvaluationEngine {
  constructor(private readonly scoreToReturn: ScoreArtifact) {}
  async evaluate(_report: ExecutionReport): Promise<ScoreArtifact> {
    return this.scoreToReturn;
  }
}

describe("EvolutionController Suite", () => {
  it("processes a candidate through MAP-Elites", async () => {
    const candidate: MutatedCodeArtifact = {
      artifact_id: "cand-1",
      content_hash: "hash",
      code: "console.log('hi');",
      lineage: { artifact_id: "cand-1", generation: 1 }
    };
    const dataset: EvaluationDatasetArtifact = { dataset_id: "data-1", records: [] };
    
    const score: ScoreArtifact = {
      artifact_id: "score-1",
      candidate_id: "cand-1",
      score: 95,
      behavior: { accuracy_band: "high", latency_band: "low", memory_band: "low" },
      metrics: { latency: 10 }
    };

    const policyEngine = new DefaultEvolutionPolicyEngine({
      policy_id: "pol-1",
      policy: {
        allowed_models: ["gpt-4"],
        max_mutation_ratio: 0.5,
        require_replay: true,
        require_audit: true,
        min_quality_gain: 90,
        max_regression_latency: 50,
        promotion_requires_review: false
      }
    });

    const archive = new MapElitesArchive();
    const controller = new EvolutionController(new MockExecutor(), new MockEvaluator(score), archive, policyEngine);

    await controller.processCandidate(candidate, dataset);

    const elites = archive.getElites();
    expect(elites).toHaveLength(1);
    expect(elites[0].score.score).toBe(95);
    expect(elites[0].is_elite).toBe(true);
  });

  it("drops candidate if policy fails", async () => {
    const candidate: MutatedCodeArtifact = {
      artifact_id: "cand-1",
      content_hash: "hash",
      code: "console.log('hi');",
      lineage: { artifact_id: "cand-1", generation: 1 }
    };
    const dataset: EvaluationDatasetArtifact = { dataset_id: "data-1", records: [] };
    
    const score: ScoreArtifact = {
      artifact_id: "score-1",
      candidate_id: "cand-1",
      score: 80, // Fails min_quality_gain (90)
      behavior: { accuracy_band: "high", latency_band: "low", memory_band: "low" },
      metrics: { latency: 10 }
    };

    const policyEngine = new DefaultEvolutionPolicyEngine({
      policy_id: "pol-1",
      policy: {
        allowed_models: ["gpt-4"],
        max_mutation_ratio: 0.5,
        require_replay: true,
        require_audit: true,
        min_quality_gain: 90,
        max_regression_latency: 50,
        promotion_requires_review: false
      }
    });

    const archive = new MapElitesArchive();
    const controller = new EvolutionController(new MockExecutor(), new MockEvaluator(score), archive, policyEngine);

    await controller.processCandidate(candidate, dataset);

    const elites = archive.getElites();
    expect(elites).toHaveLength(0);
  });
});
