import { describe, it, expect } from "vitest";
import { createEmptyRuntimeState } from "../../kernel/RuntimeState.js";
import {
  buildManifest,
  createPlatformHarness,
  runCapabilityOnce,
} from "../harness/PlatformHarness.js";

describe("Integrity — ReleaseIsolation", () => {
  it("execution on Release A never resolves Capability from Release B", async () => {
    const seed = "seed:release-iso";
    const releaseA = createPlatformHarness({
      snapshot_id: "snap-rel-a",
      release_id: "release-A",
      seed,
      capabilities: [
        {
          artifact_id: "cap-from-a",
          capability_key: "iso.a",
          implementation_id: "impl-a",
          handler: async () => [{ artifact_id: "out-a" }],
        },
      ],
    });

    const releaseB = createPlatformHarness({
      snapshot_id: "snap-rel-b",
      release_id: "release-B",
      seed,
      capabilities: [
        {
          artifact_id: "cap-from-b",
          capability_key: "iso.b",
          implementation_id: "impl-b",
          handler: async () => [{ artifact_id: "out-b" }],
        },
      ],
    });

    expect(releaseA.registry.resolveCapabilityByRef("cap-from-b")).toBeNull();
    expect(releaseB.registry.resolveCapabilityByRef("cap-from-a")).toBeNull();
    expect(releaseA.registry.getReleaseSnapshot().release.release_id).toBe(
      "release-A",
    );
    expect(releaseB.registry.getReleaseSnapshot().release.release_id).toBe(
      "release-B",
    );

    // Kernel for A admits only with grant for cap-from-a
    const ok = await runCapabilityOnce(
      releaseA,
      buildManifest({
        manifest_id: "m-on-a",
        capability_id: "cap-from-a",
        seed,
      }),
    );
    expect(ok.result.admission.decision).toBe("admitted");

    // Attempting to execute B's capability id against A's runtime fails at admit (no grant) / resolve
    const cross = await runCapabilityOnce(
      releaseA,
      buildManifest({
        manifest_id: "m-cross",
        capability_id: "cap-from-b",
        seed,
      }),
    );
    expect(cross.result.admission.decision).toBe("denied");
    expect(cross.result.admission.reason_codes).toContain("CAPABILITY_NOT_GRANTED");

    // CapabilityRuntime on A cannot execute B's ref
    await expect(
      releaseA.capabilityRuntime.execute({
        capability_ref: {
          artifact_id: "cap-from-b",
          artifact_type: "CAPABILITY_DEFINITION",
        },
        input_refs: [],
        state: createEmptyRuntimeState(),
      }),
    ).rejects.toThrow(/Capability not in registry/);
  });

  it("registry_hash differs across releases with different capability sets", () => {
    const a = createPlatformHarness({
      snapshot_id: "s1",
      release_id: "r1",
      seed: "s",
      capabilities: [
        {
          artifact_id: "cap-1",
          capability_key: "k1",
          implementation_id: "i1",
          handler: async () => [{ artifact_id: "o" }],
        },
      ],
    });
    const b = createPlatformHarness({
      snapshot_id: "s2",
      release_id: "r2",
      seed: "s",
      capabilities: [
        {
          artifact_id: "cap-2",
          capability_key: "k2",
          implementation_id: "i2",
          handler: async () => [{ artifact_id: "o" }],
        },
      ],
    });
    expect(a.registry.toSnapshotView().registry_hash).not.toBe(
      b.registry.toSnapshotView().registry_hash,
    );
  });
});
