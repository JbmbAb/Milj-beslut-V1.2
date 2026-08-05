import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  REGISTRY_KIND_NAMES,
  REGISTRY_RUNTIME_VERSION,
} from "./RegistryContracts.js";
import { createRegistryRuntime } from "./RegistryRuntime.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function walkTs(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "node_modules" || name === "dist") continue;
      walkTs(full, out);
    } else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

describe("Registry Runtime (Epoch II §2.3)", () => {
  it("exposes version and five normative registry kinds", () => {
    expect(REGISTRY_RUNTIME_VERSION).toBe("1.0.0");
    expect([...REGISTRY_KIND_NAMES]).toEqual([
      "CapabilityRegistry",
      "WorkflowRegistry",
      "RuleRegistry",
      "ProviderRegistry",
      "ReleaseRegistry",
    ]);
  });

  it("resolves capability / workflow / rule / provider by key and ref", () => {
    const runtime = createRegistryRuntime({
      snapshot_id: "snap-1",
      release_id: "rel-1",
      capabilities: [
        {
          artifact_id: "cap-1",
          artifact_type: "CAPABILITY_DEFINITION",
          capability_key: "demo.cap",
          capability_version: "1.0.0",
          implementation_ref: { artifact_id: "impl-1" },
          input_types: ["SPATIAL_EVIDENCE"],
          output_types: ["assessment"],
        },
      ],
      workflows: [
        {
          artifact_id: "wf-1",
          artifact_type: "WORKFLOW_DEFINITION",
          workflow_key: "demo.wf",
          workflow_version: "1.0.0",
          steps: [{ step_id: "s1", capability_ref: { artifact_id: "cap-1" } }],
        },
      ],
      rules: [
        {
          artifact_id: "rule-1",
          artifact_type: "RULE_BINDING",
          rule_key: "demo.rules",
          binding_ref: { artifact_id: "impl-1" },
        },
      ],
      providers: [
        {
          artifact_id: "prov-1",
          artifact_type: "PROVIDER_BINDING",
          provider_key: "demo.spatial",
          provider_kind: "spatial",
          implementation_ref: { artifact_id: "impl-postgis" },
        },
      ],
    });

    expect(runtime.resolveCapabilityByKey("demo.cap")?.artifact_id).toBe("cap-1");
    expect(runtime.resolveCapabilityByRef("cap-1")?.implementation_ref.artifact_id).toBe(
      "impl-1",
    );
    expect(runtime.resolveWorkflowByKey("demo.wf")?.steps).toHaveLength(1);
    expect(runtime.resolveRuleByKey("demo.rules")?.binding_ref.artifact_id).toBe("impl-1");
    expect(runtime.resolveProviderByKey("demo.spatial")?.provider_kind).toBe("spatial");
    expect(runtime.toSnapshotView().snapshot_id).toBe("snap-1");
    expect(runtime.toSnapshotView().registry_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(runtime.getReleaseSnapshot().release.release_id).toBe("rel-1");
  });

  it("fail-closed on empty capabilities and duplicate keys", () => {
    expect(() =>
      createRegistryRuntime({
        snapshot_id: "s",
        release_id: "r",
        capabilities: [],
        workflows: [],
      }),
    ).toThrow(/at least one capability/);

    expect(() =>
      createRegistryRuntime({
        snapshot_id: "s",
        release_id: "r",
        capabilities: [
          {
            artifact_id: "cap-a",
            artifact_type: "CAPABILITY_DEFINITION",
            capability_key: "same",
            capability_version: "1.0.0",
            implementation_ref: { artifact_id: "i1" },
            input_types: [],
            output_types: [],
          },
          {
            artifact_id: "cap-b",
            artifact_type: "CAPABILITY_DEFINITION",
            capability_key: "same",
            capability_version: "1.0.0",
            implementation_ref: { artifact_id: "i2" },
            input_types: [],
            output_types: [],
          },
        ],
        workflows: [],
      }),
    ).toThrow(/duplicate capability_key/);
  });

  it("registry module never imports domain packages", () => {
    const files = walkTs(__dirname);
    const violations: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      if (/from\s+['"][^'"]*mps-lu[^'"]*['"]/.test(src)) {
        violations.push(file);
      }
      if (/LURuleEngine|PostgisSpatialProvider/.test(src)) {
        violations.push(file);
      }
    }
    expect(violations).toEqual([]);
  });
});
