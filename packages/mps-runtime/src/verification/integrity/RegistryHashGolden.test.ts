import { describe, it, expect } from "vitest";
import { createRegistryRuntime } from "../../registry/RegistryRuntime.js";
import type { CapabilityRegistryEntry } from "../../registry/RegistryContracts.js";

function cap(
  artifact_id: string,
  capability_key: string,
): CapabilityRegistryEntry {
  return {
    artifact_id,
    artifact_type: "CAPABILITY_DEFINITION",
    capability_key,
    capability_version: "1.0.0",
    implementation_ref: { artifact_id: `impl-${artifact_id}` },
    input_types: ["IN"],
    output_types: ["OUT"],
  };
}

describe("Integrity — RegistryHashGolden / RegistryDeterminism", () => {
  it("different seed order → same registry_hash and content_hash", () => {
    const a = createRegistryRuntime({
      snapshot_id: "snap-gold",
      release_id: "rel-gold",
      capabilities: [cap("cap-z", "k.z"), cap("cap-a", "k.a"), cap("cap-m", "k.m")],
      workflows: [
        {
          artifact_id: "wf-b",
          artifact_type: "WORKFLOW_DEFINITION",
          workflow_key: "w.b",
          workflow_version: "1.0.0",
          steps: [{ step_id: "s", capability_ref: { artifact_id: "cap-a" } }],
        },
        {
          artifact_id: "wf-a",
          artifact_type: "WORKFLOW_DEFINITION",
          workflow_key: "w.a",
          workflow_version: "1.0.0",
          steps: [{ step_id: "s", capability_ref: { artifact_id: "cap-z" } }],
        },
      ],
    });

    const b = createRegistryRuntime({
      snapshot_id: "snap-gold",
      release_id: "rel-gold",
      capabilities: [cap("cap-a", "k.a"), cap("cap-m", "k.m"), cap("cap-z", "k.z")],
      workflows: [
        {
          artifact_id: "wf-a",
          artifact_type: "WORKFLOW_DEFINITION",
          workflow_key: "w.a",
          workflow_version: "1.0.0",
          steps: [{ step_id: "s", capability_ref: { artifact_id: "cap-z" } }],
        },
        {
          artifact_id: "wf-b",
          artifact_type: "WORKFLOW_DEFINITION",
          workflow_key: "w.b",
          workflow_version: "1.0.0",
          steps: [{ step_id: "s", capability_ref: { artifact_id: "cap-a" } }],
        },
      ],
    });

    expect(a.getReleaseSnapshot().registry_hash.value).toBe(
      b.getReleaseSnapshot().registry_hash.value,
    );
    expect(a.getReleaseSnapshot().content_hash.value).toBe(
      b.getReleaseSnapshot().content_hash.value,
    );
    expect(a.toSnapshotView().registry_hash).toBe(b.toSnapshotView().registry_hash);
  });
});
