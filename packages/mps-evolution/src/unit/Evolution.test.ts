import { describe, expect, it } from "vitest";
import {
  EvolutionController,
  DefaultContentIdentityEngine,
  MutationSandbox,
  EvaluationEngine,
  SelectionEngine,
} from "../index";
import type {
  MutationEngine,
  EvolutionExecutor,
  EvolutionPolicyEngine,
  EvolutionSeedArtifact,
  EvaluationDatasetArtifact,
  SelectionObjectives,
  EvolutionPromotionDecision,
  EvolutionArtifact,
} from "../index";
import type { ExecutionReport } from "@miljobeslut/mps-runtime";
import type { ReplayResult, ReplayEngine } from "@miljobeslut/mps-replay";

// --- Mock Helpers ---

class MockMutationEngine implements MutationEngine {
  async mutate(seed: EvolutionSeedArtifact): Promise<any> {
    return {
      schema_version: "evolution.mutation.v1",
      mutation_id: "mut-001",
      parent_seed_id: seed.seed_id,
      code_hash: "code-hash-abc",
      code: new Uint8Array([1, 2, 3]),
      mutation_metadata: {
        model: "gemini-1.5-pro",
        model_version: "v1.0",
        model_digest: "model-digest-abc",
        temperature: 0.7,
        prompt_hash: "prompt-hash-123",
        changed_regions: ["main_loop"],
        mutation_type: "structural",
        created_at: new Date().toISOString(),
      },
    };
  }
}

class MockExecutor implements EvolutionExecutor {
  async executeCandidate(): Promise<ExecutionReport> {
    return {
      runtime_id: "run-exec",
      started_at: "2026-07-31T12:00:00Z",
      finished_at: "2026-07-31T12:00:01Z",
      registry_snapshot_id: "snap-123",
      registry_hash: "reg-hash-123",
      stages: [],
      replay: {} as ReplayResult,
      completed: true,
      accuracy: 0.98,
      memory_mb: 128,
    } as any;
  }
}

class MockReplayEngine implements ReplayEngine {
  async replay(): Promise<ReplayResult> {
    return {
      context: { session_id: "rep-sess-abc", started_at: "2026-07-31", replay_profile_name: "strict" },
      steps: [],
      failures: [],
      completed: true,
      execution_match: true,
      artifact_match: true,
      policy_match: true,
      policy_diffs: [],
    };
  }
}

class MockPolicyEngine implements EvolutionPolicyEngine {
  async decide(_artifact: EvolutionArtifact): Promise<EvolutionPromotionDecision> {
    return "PROMOTE";
  }
}

const mockSerializer = { serialize: (val: any) => new TextEncoder().encode(JSON.stringify(val)) };

describe("EvolutionController & MAP-Elites Core Suite", () => {
  const identity = new DefaultContentIdentityEngine(mockSerializer);
  const sandbox = new MutationSandbox(new MockMutationEngine());
  const evaluation = new EvaluationEngine(new MockExecutor(), new MockReplayEngine(), identity);
  const selection = new SelectionEngine(identity);
  const policy = new MockPolicyEngine();

  it("should run complete generation, evaluate scores, select MAP-Elites, and output a valid evolution artifact", async () => {
    const controller = new EvolutionController(sandbox, evaluation, selection, policy, identity);

    const seed: EvolutionSeedArtifact = {
      schema_version: "evolution.seed.v1",
      seed_id: "seed-123",
      seed_hash: "seed-hash-abc",
      code: new Uint8Array([0, 1]),
      metadata: { created_at: "2026-07-31" },
    };

    const dataset: EvaluationDatasetArtifact = {
      dataset_id: "dataset-pfas-v1",
      dataset_hash: "dataset-hash-123",
    };

    const objectives: SelectionObjectives = {
      maximize: ["accuracy"],
      minimize: ["runtime_ms", "memory_mb"],
    };

    const result = await controller.runGeneration(1, seed, dataset, objectives, []);

    expect(result.evolutionArtifact.evolution_id).toBe("evo-0001");
    expect(result.evolutionArtifact.seed_hash).toBe("seed-hash-abc");
    expect(result.promotion).toBe("PROMOTE");
    expect(result.elites.generation).toBe(1);
    expect(result.scores).toHaveLength(10);
    expect(result.mutations).toHaveLength(10);
  });
});
