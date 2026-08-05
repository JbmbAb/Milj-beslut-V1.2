import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createEmptyRuntimeState } from "../kernel/RuntimeState.js";
import { sha256ContentHash } from "../kernel/ExecutionKernel.js";
import {
  OBSERVABILITY_RUNTIME_VERSION,
  ObservabilityRuntime,
} from "./index.js";
import type { FrozenWorkflowExecutionArtifact } from "../contracts/freeze/FrozenIdentities.js";

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

function sampleState() {
  const state = createEmptyRuntimeState();
  state.manifest = {
    manifest_id: "m-1",
    artifact_type: "execution_manifest",
    execution_identity_ref: {
      artifact_id: "id-1",
      artifact_type: "execution_identity",
    },
    capability_resolution_ref: {
      artifact_id: "cap-1",
      artifact_type: "CAPABILITY_DEFINITION",
    },
    parameters: {},
    content_hash: sha256ContentHash({ m: 1 }),
  };
  state.attempt = {
    attempt_id: "attempt-m-1-1",
    artifact_type: "execution_attempt",
    manifest_ref: {
      artifact_id: "m-1",
      artifact_type: "execution_manifest",
    },
    attempt_number: 1,
    started_at: "seed:1",
    content_hash: sha256ContentHash({ a: 1 }),
  };
  state.execution_graph = {
    nodes: [
      {
        node_id: "cap-0",
        kind: "capability",
        ref: {
          artifact_id: "exec-cap-1",
          artifact_type: "CAPABILITY_EXECUTION",
        },
      },
    ],
    edges: [],
  };
  return state;
}

describe("Observability Runtime (Epoch II §2.8)", () => {
  it("exposes version", () => {
    expect(OBSERVABILITY_RUNTIME_VERSION).toBe("1.0.0");
    expect(ObservabilityRuntime.create().version).toBe("1.0.0");
  });

  it("collects graph, lineage, and deterministic trace from RuntimeState", () => {
    const obs = ObservabilityRuntime.create();
    const state = sampleState();
    const bundle = obs.collectFromRuntimeState({
      state,
      outcome_ref: {
        artifact_id: "outcome-1",
        artifact_type: "execution_outcome",
      },
      capability_execution_refs: [
        {
          artifact_id: "exec-cap-1",
          artifact_type: "CAPABILITY_EXECUTION",
        },
      ],
    });

    expect(bundle.kind).toBe("observability_bundle");
    expect(bundle.execution_graph.nodes).toHaveLength(1);
    expect(bundle.lineage.edges.some((e) => e.relation === "manifest_to_attempt")).toBe(
      true,
    );
    expect(bundle.lineage.edges.some((e) => e.relation === "attempt_to_outcome")).toBe(
      true,
    );
    expect(bundle.trace.trace_id).toMatch(/^[a-f0-9]{64}$/);
    expect(bundle.trace.span_ids).toHaveLength(1);
    expect(bundle.replay_log).toBeNull();
    expect(bundle.bundle_hash.value).toMatch(/^[a-f0-9]{64}$/);
  });

  it("same inputs → same bundle_hash and trace_id (deterministic)", () => {
    const obs = ObservabilityRuntime.create();
    const state = sampleState();
    const input = {
      state,
      outcome_ref: {
        artifact_id: "outcome-1",
        artifact_type: "execution_outcome",
      },
      capability_execution_refs: [
        {
          artifact_id: "exec-cap-1",
          artifact_type: "CAPABILITY_EXECUTION",
        },
      ],
    };
    const a = obs.collectFromRuntimeState(input);
    const b = obs.collectFromRuntimeState(input);
    expect(a.trace.trace_id).toBe(b.trace.trace_id);
    expect(a.bundle_hash.value).toBe(b.bundle_hash.value);
  });

  it("collectFromReplay attaches replay_log without CAS write", () => {
    const obs = ObservabilityRuntime.create();
    const state = sampleState();
    const bundle = obs.collectFromReplay({
      state,
      prior_hash: "a".repeat(64),
      replayed_hash: "a".repeat(64),
      equivalent: true,
      workflow_or_manifest_ref: {
        artifact_id: "m-1",
        artifact_type: "execution_manifest",
      },
    });
    expect(bundle.replay_log?.equivalent).toBe(true);
    expect(bundle.replay_log?.prior_hash).toBe("a".repeat(64));
  });

  it("collectFromWorkflowExecution synthesizes step graph", () => {
    const obs = ObservabilityRuntime.create();
    const wf: FrozenWorkflowExecutionArtifact = {
      artifact_id: "wf-exec-1",
      artifact_type: "WORKFLOW_EXECUTION",
      workflow_definition_ref: {
        artifact_id: "wf-1",
        artifact_type: "WORKFLOW_DEFINITION",
      },
      execution_refs: [
        { artifact_id: "exec-a", artifact_type: "CAPABILITY_EXECUTION" },
        { artifact_id: "exec-b", artifact_type: "CAPABILITY_EXECUTION" },
      ],
      execution_order: ["step_a", "step_b"],
      workflow_hash: sha256ContentHash({ w: 1 }),
      workflow_definition_hash: sha256ContentHash({ d: 1 }),
      content_hash: sha256ContentHash({ c: 1 }),
    };
    const bundle = obs.collectFromWorkflowExecution({
      workflow_execution: wf,
    });
    expect(bundle.execution_graph.nodes).toHaveLength(2);
    expect(bundle.execution_graph.edges).toHaveLength(1);
    expect(bundle.lineage.edges.some((e) => e.relation === "step_order")).toBe(
      true,
    );
  });

  it("facade has no put / write surface and never imports domain", () => {
    const runtimeSrc = readFileSync(
      path.join(__dirname, "ObservabilityRuntime.ts"),
      "utf8",
    );
    expect(runtimeSrc).not.toMatch(/\bput\s*\(/);
    expect(runtimeSrc).not.toContain("artifactRepository");
    expect(runtimeSrc).not.toContain("Date.now");
    expect(runtimeSrc).not.toContain("Math.random");

    const violations: string[] = [];
    for (const file of walkTs(__dirname)) {
      const src = readFileSync(file, "utf8");
      if (/from\s+['"][^'"]*mps-lu[^'"]*['"]/.test(src)) {
        violations.push(file);
      }
      if (/LURuleEngine|mps-telemetry/.test(src)) {
        violations.push(file);
      }
    }
    expect(violations).toEqual([]);
  });
});
