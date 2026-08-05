import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRegistryRuntime } from "../registry/RegistryRuntime.js";
import { CapabilityRuntime } from "../capability/CapabilityRuntime.js";
import {
  WORKFLOW_RUNTIME_VERSION,
  WorkflowRuntime,
} from "./WorkflowRuntime.js";
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

function demoStack() {
  const registry = createRegistryRuntime({
    snapshot_id: "snap-wf",
    release_id: "rel-wf",
    capabilities: [
      {
        artifact_id: "cap-a",
        artifact_type: "CAPABILITY_DEFINITION",
        capability_key: "demo.a",
        capability_version: "1.0.0",
        implementation_ref: { artifact_id: "impl-a" },
        input_types: ["IN"],
        output_types: ["MID"],
      },
      {
        artifact_id: "cap-b",
        artifact_type: "CAPABILITY_DEFINITION",
        capability_key: "demo.b",
        capability_version: "1.0.0",
        implementation_ref: { artifact_id: "impl-b" },
        input_types: ["MID"],
        output_types: ["OUT"],
      },
    ],
    workflows: [
      {
        artifact_id: "wf-demo",
        artifact_type: "WORKFLOW_DEFINITION",
        workflow_key: "demo.pipeline",
        workflow_version: "1.0.0",
        steps: [
          { step_id: "step_a", capability_ref: { artifact_id: "cap-a" } },
          { step_id: "step_b", capability_ref: { artifact_id: "cap-b" } },
        ],
      },
    ],
  });

  const handlers = new Map([
    [
      "impl-a",
      async (inputs: readonly { artifact_id: string }[]) => [
        { artifact_id: `mid-from-${inputs[0]?.artifact_id ?? "empty"}` },
      ],
    ],
    [
      "impl-b",
      async (inputs: readonly { artifact_id: string }[]) => [
        { artifact_id: `out-from-${inputs[0]?.artifact_id ?? "empty"}` },
      ],
    ],
  ]);

  const capabilityRuntime = CapabilityRuntime.create({ registry, handlers });
  const workflowRuntime = WorkflowRuntime.create({
    registry,
    capabilityRuntime,
  });

  return { registry, workflowRuntime };
}

describe("Workflow Runtime (Epoch II §2.6)", () => {
  it("exposes version", () => {
    expect(WORKFLOW_RUNTIME_VERSION).toBe("1.0.0");
  });

  it("runs registry steps in order and pipes outputs", async () => {
    const { workflowRuntime } = demoStack();
    const state = createEmptyRuntimeState();
    const exec = await workflowRuntime.execute({
      workflow_definition_ref: {
        artifact_id: "wf-demo",
        artifact_type: "WORKFLOW_DEFINITION",
      },
      input_refs: [{ artifact_id: "seed-1", artifact_type: "IN" }],
      state,
    });

    expect(exec.artifact_type).toBe("WORKFLOW_EXECUTION");
    expect(exec.execution_order).toEqual(["step_a", "step_b"]);
    expect(exec.execution_refs).toHaveLength(2);
    expect(exec.workflow_definition_ref.artifact_id).toBe("wf-demo");
    expect(exec.content_hash.value).toMatch(/^[a-f0-9]{64}$/);
    expect(exec.artifact_id).toContain("wf-exec-wf-demo-");
  });

  it("replay is equivalent for same inputs", async () => {
    const { workflowRuntime } = demoStack();
    const state = createEmptyRuntimeState();
    const args = {
      workflow_definition_ref: {
        artifact_id: "wf-demo" as const,
        artifact_type: "WORKFLOW_DEFINITION" as const,
      },
      input_refs: [{ artifact_id: "seed-1", artifact_type: "IN" }],
      state,
    };
    const prior = await workflowRuntime.execute(args);
    const { equivalent, replayed } = await workflowRuntime.replay({
      ...args,
      prior_execution: prior,
    });
    expect(equivalent).toBe(true);
    expect(replayed.content_hash.value).toBe(prior.content_hash.value);
    expect(replayed.execution_order).toEqual(prior.execution_order);
  });

  it("asExecutorPort matches WorkflowExecutorPort shape", async () => {
    const { workflowRuntime } = demoStack();
    const port = workflowRuntime.asExecutorPort();
    const exec = await port.execute({
      workflow_definition_ref: {
        artifact_id: "wf-demo",
        artifact_type: "WORKFLOW_DEFINITION",
      },
      input_refs: [],
      state: createEmptyRuntimeState(),
    });
    expect(exec.execution_order).toEqual(["step_a", "step_b"]);
  });

  it("fail-closed: missing workflow, empty steps, missing capability", async () => {
    const registry = createRegistryRuntime({
      snapshot_id: "s",
      release_id: "r",
      capabilities: [
        {
          artifact_id: "cap-only",
          artifact_type: "CAPABILITY_DEFINITION",
          capability_key: "only",
          capability_version: "1.0.0",
          implementation_ref: { artifact_id: "impl-only" },
          input_types: [],
          output_types: ["X"],
        },
      ],
      workflows: [
        {
          artifact_id: "wf-empty",
          artifact_type: "WORKFLOW_DEFINITION",
          workflow_key: "empty",
          workflow_version: "1.0.0",
          steps: [],
        },
        {
          artifact_id: "wf-bad-cap",
          artifact_type: "WORKFLOW_DEFINITION",
          workflow_key: "bad",
          workflow_version: "1.0.0",
          steps: [
            {
              step_id: "s1",
              capability_ref: { artifact_id: "missing-cap" },
            },
          ],
        },
      ],
    });
    const capabilityRuntime = CapabilityRuntime.create({
      registry,
      handlers: new Map([
        ["impl-only", async () => [{ artifact_id: "o" }]],
      ]),
    });
    const runtime = WorkflowRuntime.create({ registry, capabilityRuntime });
    const state = createEmptyRuntimeState();

    await expect(
      runtime.execute({
        workflow_definition_ref: {
          artifact_id: "missing-wf",
          artifact_type: "WORKFLOW_DEFINITION",
        },
        input_refs: [],
        state,
      }),
    ).rejects.toThrow(/Workflow not in registry/);

    await expect(
      runtime.execute({
        workflow_definition_ref: {
          artifact_id: "wf-empty",
          artifact_type: "WORKFLOW_DEFINITION",
        },
        input_refs: [],
        state,
      }),
    ).rejects.toThrow(/no steps/);

    await expect(
      runtime.execute({
        workflow_definition_ref: {
          artifact_id: "wf-bad-cap",
          artifact_type: "WORKFLOW_DEFINITION",
        },
        input_refs: [],
        state,
      }),
    ).rejects.toThrow(/capability not in registry/);
  });

  it("workflow module never imports domain packages", () => {
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
