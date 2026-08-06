import { describe, it, expect } from "vitest";
import { createRegistryRuntime } from "../../registry/RegistryRuntime.js";
import type { CapabilityRegistryEntry } from "../../registry/RegistryContracts.js";

describe("Integrity — RegistryFreeze", () => {
  it("release snapshot is frozen; mutation does not alter resolve", () => {
    "use strict";
    const runtime = createRegistryRuntime({
      snapshot_id: "snap-freeze",
      release_id: "rel-freeze",
      capabilities: [
        {
          artifact_id: "cap-1",
          artifact_type: "CAPABILITY_DEFINITION",
          capability_key: "freeze.one",
          capability_version: "1.0.0",
          implementation_ref: { artifact_id: "impl-1" },
          input_types: ["IN"],
          output_types: ["OUT"],
        },
      ],
      workflows: [],
    });

    const snap = runtime.getReleaseSnapshot();
    expect(Object.isFrozen(snap)).toBe(true);
    expect(Object.isFrozen(snap.capabilities)).toBe(true);
    expect(Object.isFrozen(snap.release)).toBe(true);

    expect(() => {
      (snap as { snapshot_id: string }).snapshot_id = "hijacked";
    }).toThrow();

    expect(() => {
      (snap.capabilities as CapabilityRegistryEntry[]).push({
        artifact_id: "cap-evil",
        artifact_type: "CAPABILITY_DEFINITION",
        capability_key: "freeze.evil",
        capability_version: "9.9.9",
        implementation_ref: { artifact_id: "impl-evil" },
        input_types: [],
        output_types: [],
      });
    }).toThrow();

    expect(runtime.resolveCapabilityByKey("freeze.evil")).toBeNull();
    expect(runtime.resolveCapabilityByKey("freeze.one")?.artifact_id).toBe("cap-1");
    expect(runtime.getReleaseSnapshot().snapshot_id).toBe("snap-freeze");
  });

  it("execution uses its own snapshot — a newer registry does not replace it", () => {
    const releaseA = createRegistryRuntime({
      snapshot_id: "snap-a",
      release_id: "rel-a",
      capabilities: [
        {
          artifact_id: "cap-a",
          artifact_type: "CAPABILITY_DEFINITION",
          capability_key: "domain.a",
          capability_version: "1.0.0",
          implementation_ref: { artifact_id: "impl-a" },
          input_types: ["IN"],
          output_types: ["OUT"],
        },
      ],
      workflows: [],
    });

    // "Latest" registry with different capability — must not affect releaseA.
    createRegistryRuntime({
      snapshot_id: "snap-b-latest",
      release_id: "rel-b",
      capabilities: [
        {
          artifact_id: "cap-b",
          artifact_type: "CAPABILITY_DEFINITION",
          capability_key: "domain.b",
          capability_version: "2.0.0",
          implementation_ref: { artifact_id: "impl-b" },
          input_types: ["IN"],
          output_types: ["OUT"],
        },
      ],
      workflows: [],
    });

    expect(releaseA.resolveCapabilityByKey("domain.a")?.artifact_id).toBe("cap-a");
    expect(releaseA.resolveCapabilityByKey("domain.b")).toBeNull();
    expect(releaseA.toSnapshotView().snapshot_id).toBe("snap-a");
  });
});
