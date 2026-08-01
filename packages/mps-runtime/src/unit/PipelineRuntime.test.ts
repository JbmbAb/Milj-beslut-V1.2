import { describe, expect, it } from "vitest";
import {
  PipelineRuntime,
  ExecutionContext,
  StageInput,
} from "../index";
import type {
  RegistrySnapshot,
} from "@miljobeslut/mps-registry";
import type {
  ArtifactStore,
} from "@miljobeslut/mps-artifact-store";
import type {
  ReplayResult,
  ReplayEngine,
} from "@miljobeslut/mps-replay";
import type {
  ArtifactVerifier,
  VerificationResult,
  DecisionClock,
  UniqueIdGenerator,
} from "@miljobeslut/mps-core";

class MockStore implements ArtifactStore {
  async get<T>(_reference: any): Promise<T> {
    return { mock: "artifact" } as any;
  }
  async put<TEnvelope>(envelope: TEnvelope): Promise<any> {
    return { reference: { id: "stored-id", content_hash: { algorithm: "sha256", digest: "stored-digest" } }, artifact: envelope };
  }
  async has(_reference: any): Promise<boolean> {
    return true;
  }
}

class MockVerifier implements ArtifactVerifier {
  async verify(_artifact: unknown): Promise<VerificationResult> {
    return {
      integrity: true,
      signature_valid: true,
      trusted: true,
    };
  }
}

class MockReplayEngine implements ReplayEngine {
  async replay(_targets: any[]): Promise<ReplayResult> {
    return {
      context: { session_id: "rep-1", started_at: "2026-07-31", replay_profile_name: "test" },
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

describe("PipelineRuntime Suite", () => {
  it("should run the full stages and return successful ExecutionReport", async () => {
    const registry: RegistrySnapshot = {
      snapshot_id: "snapshot-123",
      registry_hash: "hash-456",
      created_at: "2026-07-31",
      governance_profiles: [],
      policy_sets: [],
      replay_profiles: [],
      archive_profiles: [],
      promotion_profiles: [],
    };

    const ctx: ExecutionContext = {
      registry,
      store: new MockStore(),
      governance: { evaluate: async () => ({ value: "evaluated-gov" }) },
      archive: { archive: async () => ({ value: "archived" }) },
      promotion: { promote: async () => ({ value: "promoted" }) },
      replay: new MockReplayEngine(),
      artifactVerifier: new MockVerifier(),
      clock: { now: () => new Date("2026-07-31T12:00:00.000Z") },
      idGen: { generate: () => "run-id-999" },
    };

    const runtime = new PipelineRuntime(ctx);
    const stages: StageInput[] = [
      { stage: "GOVERNANCE", reference: { id: "ref-1", content_hash: { algorithm: "sha256", digest: "d1" } } },
      { stage: "ARCHIVE", reference: { id: "ref-2", content_hash: { algorithm: "sha256", digest: "d2" } } },
    ];

    const report = await runtime.run(stages);

    expect(report.runtime_id).toBe("run-id-999");
    expect(report.registry_snapshot_id).toBe("snapshot-123");
    expect(report.registry_hash).toBe("hash-456");
    expect(report.stages).toHaveLength(2);
    expect(report.completed).toBe(true);
  });
});
