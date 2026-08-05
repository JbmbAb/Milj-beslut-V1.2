import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRegistryRuntime } from "../registry/RegistryRuntime.js";
import {
  CAPABILITY_RUNTIME_VERSION,
  CapabilityRuntime,
} from "./CapabilityRuntime.js";
import { createEmptyRuntimeState } from "../kernel/RuntimeState.js";

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

function demoRegistry() {
  return createRegistryRuntime({
    snapshot_id: "snap-cap",
    release_id: "rel-cap",
    capabilities: [
      {
        artifact_id: "cap-demo",
        artifact_type: "CAPABILITY_DEFINITION",
        capability_key: "demo.assess",
        capability_version: "1.0.0",
        implementation_ref: { artifact_id: "impl-demo-v1" },
        input_types: ["SPATIAL_EVIDENCE"],
        output_types: ["assessment_finding"],
      },
    ],
    workflows: [],
  });
}

describe("Capability Runtime (Epoch II §2.5)", () => {
  it("exposes version", () => {
    expect(CAPABILITY_RUNTIME_VERSION).toBe("1.0.0");
  });

  it("invokes via implementation_ref and returns frozen execution artifact", async () => {
    const registry = demoRegistry();
    const handlers = new Map([
      [
        "impl-demo-v1",
        async () => [{ artifact_id: "finding-1" }, { artifact_id: "finding-2" }],
      ],
    ]);
    const runtime = CapabilityRuntime.create({ registry, handlers });
    const exec = await runtime.execute({
      capability_ref: {
        artifact_id: "cap-demo",
        artifact_type: "CAPABILITY_DEFINITION",
      },
      input_refs: [],
      state: createEmptyRuntimeState(),
    });

    expect(exec.artifact_type).toBe("CAPABILITY_EXECUTION");
    expect(exec.capability_ref.artifact_id).toBe("cap-demo");
    expect(exec.output_refs.map((r) => r.artifact_id)).toEqual([
      "finding-1",
      "finding-2",
    ]);
    expect(exec.output_refs[0]?.artifact_type).toBe("assessment_finding");
    expect(exec.content_hash.value).toMatch(/^[a-f0-9]{64}$/);
    expect(exec.artifact_id).toContain("exec-cap-demo-");
  });

  it("asExecutorPort is usable by ExecutionKernel shape", async () => {
    const registry = demoRegistry();
    const runtime = CapabilityRuntime.create({
      registry,
      handlers: new Map([
        ["impl-demo-v1", async () => [{ artifact_id: "out-1" }]],
      ]),
    });
    const port = runtime.asExecutorPort();
    const result = await port.execute({
      capability_ref: {
        artifact_id: "cap-demo",
        artifact_type: "CAPABILITY_DEFINITION",
      },
      input_refs: [{ artifact_id: "in-1", artifact_type: "SPATIAL_EVIDENCE" }],
      state: createEmptyRuntimeState(),
    });
    expect(result.output_refs).toHaveLength(1);
  });

  it("fail-closed: empty handlers, missing capability, missing implementation", async () => {
    const registry = demoRegistry();
    expect(() =>
      CapabilityRuntime.create({ registry, handlers: new Map() }),
    ).toThrow(/at least one implementation handler/);

    const runtime = CapabilityRuntime.create({
      registry,
      handlers: new Map([
        ["wrong-impl", async () => [{ artifact_id: "x" }]],
      ]),
    });

    await expect(
      runtime.execute({
        capability_ref: {
          artifact_id: "missing-cap",
          artifact_type: "CAPABILITY_DEFINITION",
        },
        input_refs: [],
        state: createEmptyRuntimeState(),
      }),
    ).rejects.toThrow(/Capability not in registry/);

    await expect(
      runtime.execute({
        capability_ref: {
          artifact_id: "cap-demo",
          artifact_type: "CAPABILITY_DEFINITION",
        },
        input_refs: [],
        state: createEmptyRuntimeState(),
      }),
    ).rejects.toThrow(/No invoke handler registered/);
  });

  it("capability module never imports domain packages", () => {
    const violations: string[] = [];
    for (const file of walkTs(__dirname)) {
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
