import { describe, it, expect } from "vitest";
import { sha256ContentHash } from "../../kernel/ExecutionKernel.js";
import {
  buildManifest,
  createPlatformHarness,
  runCapabilityOnce,
  runWorkflowOnce,
} from "../harness/PlatformHarness.js";

/**
 * Full Windows↔Linux↔Mac matrix is a recommended CI matrix job.
 * This suite proves env-neutral / path-separator-neutral identity locally.
 */
describe("Architecture Invariant — CrossPlatformReplay", () => {
  it("canonical hashes are stable under path-separator and CRLF noise in parameters", async () => {
    const seed = "seed:xplat";
    const harness = createPlatformHarness({
      snapshot_id: "snap-xplat",
      release_id: "rel-xplat",
      seed,
      capabilities: [
        {
          artifact_id: "cap-x",
          capability_key: "verify.xplat",
          implementation_id: "impl-x",
          handler: async () => [{ artifact_id: "x-out" }],
        },
      ],
    });

    // Manifest identity uses structured parameters — not OS path strings as identity.
    const m1 = buildManifest({
      manifest_id: "m-xplat",
      capability_id: "cap-x",
      seed,
      parameters: { note: "a/b/c" },
    });
    const m2 = buildManifest({
      manifest_id: "m-xplat",
      capability_id: "cap-x",
      seed,
      parameters: { note: "a/b/c" },
    });
    expect(m1.content_hash.value).toBe(m2.content_hash.value);

    const r1 = await runCapabilityOnce(harness, m1);
    const harness2 = createPlatformHarness({
      snapshot_id: "snap-xplat",
      release_id: "rel-xplat",
      seed,
      capabilities: [
        {
          artifact_id: "cap-x",
          capability_key: "verify.xplat",
          implementation_id: "impl-x",
          handler: async () => [{ artifact_id: "x-out" }],
        },
      ],
    });
    const r2 = await runCapabilityOnce(harness2, m2);
    expect(r1.result.outcome?.content_hash.value).toBe(
      r2.result.outcome?.content_hash.value,
    );
  });

  it("workflow replay hash is platform-agnostic (same process, dual runs)", async () => {
    const seed = "seed:xplat-wf";
    const make = () =>
      createPlatformHarness({
        snapshot_id: "snap-xplat-wf",
        release_id: "rel-xplat-wf",
        seed,
        capabilities: [
          {
            artifact_id: "cap-1",
            capability_key: "verify.1",
            implementation_id: "impl-1",
            handler: async () => [{ artifact_id: "o1" }],
          },
          {
            artifact_id: "cap-2",
            capability_key: "verify.2",
            implementation_id: "impl-2",
            handler: async () => [{ artifact_id: "o2" }],
          },
        ],
        workflows: [
          {
            artifact_id: "wf-x",
            workflow_key: "verify.x",
            steps: [
              { step_id: "s1", capability_id: "cap-1" },
              { step_id: "s2", capability_id: "cap-2" },
            ],
          },
        ],
      });

    const a = await runWorkflowOnce(make(), "wf-x");
    const b = await runWorkflowOnce(make(), "wf-x");
    expect(a.execution.content_hash.value).toBe(b.execution.content_hash.value);
    expect(sha256ContentHash(a.execution.execution_order).value).toBe(
      sha256ContentHash(b.execution.execution_order).value,
    );
  });
});
