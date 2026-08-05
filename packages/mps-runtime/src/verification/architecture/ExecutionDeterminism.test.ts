import { describe, it, expect } from "vitest";
import {
  buildManifest,
  createPlatformHarness,
  runCapabilityOnce,
} from "../harness/PlatformHarness.js";

describe("Architecture Invariant — ExecutionDeterminism", () => {
  it("same manifest + registry snapshot + input → identical ids/hashes/graph/outcome", async () => {
    const seed = "seed:exec-det";
    const make = () =>
      createPlatformHarness({
        snapshot_id: "snap-det",
        release_id: "rel-det",
        seed,
        capabilities: [
          {
            artifact_id: "cap-det",
            capability_key: "verify.det",
            implementation_id: "impl-det",
            handler: async (inputs) => [
              {
                artifact_id: `out-${inputs[0]?.artifact_id ?? "none"}`,
              },
            ],
          },
        ],
      });

    const manifest = buildManifest({
      manifest_id: "m-det",
      capability_id: "cap-det",
      seed,
    });

    const a = await runCapabilityOnce(make(), manifest);
    const b = await runCapabilityOnce(make(), manifest);

    expect(a.result.admission.decision).toBe("admitted");
    expect(b.result.admission.decision).toBe("admitted");
    expect(a.result.attempt?.attempt_id).toBe(b.result.attempt?.attempt_id);
    expect(a.result.attempt?.content_hash.value).toBe(
      b.result.attempt?.content_hash.value,
    );
    expect(a.result.outcome?.outcome_id).toBe(b.result.outcome?.outcome_id);
    expect(a.result.outcome?.content_hash.value).toBe(
      b.result.outcome?.content_hash.value,
    );
    expect(a.result.capability_executions[0]?.artifact_id).toBe(
      b.result.capability_executions[0]?.artifact_id,
    );
    expect(a.result.capability_executions[0]?.content_hash.value).toBe(
      b.result.capability_executions[0]?.content_hash.value,
    );
    expect(a.result.state.execution_graph).toEqual(b.result.state.execution_graph);
    expect(a.obs.bundle_hash.value).toBe(b.obs.bundle_hash.value);
  });
});
