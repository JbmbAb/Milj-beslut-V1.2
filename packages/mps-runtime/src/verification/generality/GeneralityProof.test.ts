import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runLuAssessmentViaKernel } from "../../../../mps-lu/src/execution/LuExecutionKernelClient.js";
import type { SpatialEvidenceArtifact } from "../../../../mps-lu/src/artifacts/SpatialEvidenceArtifact.js";
import {
  buildManifest,
  createPlatformHarness,
  runCapabilityOnce,
  runWorkflowOnce,
} from "../harness/PlatformHarness.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const verificationRoot = path.resolve(__dirname, "..");

function walkTs(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "node_modules" || name === "dist") continue;
      walkTs(full, out);
    } else if (
      name.endsWith(".ts") &&
      !name.endsWith(".test.ts") &&
      !name.includes("GeneralityProof")
    ) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Three-way generality: real domain (LU) + minimal domain (Dummy) + domain-less workflow.
 */
describe("Generality Proof — LU + Dummy + Synthetic Workflow", () => {
  // RC8-K: bootstrap admission is opt-in only; no real FrozenCore verification context exists
  // yet, so tests exercising runLuAssessmentViaKernel declare the opt-in explicitly.
  beforeEach(() => {
    process.env.MPS_LU_BOOTSTRAP_ADMIT = "1";
  });
  afterEach(() => {
    delete process.env.MPS_LU_BOOTSTRAP_ADMIT;
  });

  it("LU real domain completes Admit → Capability → Artifacts lifecycle", async () => {
    // GENERALITY-PROOF-01: LURuleEngine requires payload.result_semantics (EXISTENCE_WITHIN_DISTANCE
    // + result.exists) on spatial evidence -- the shape already canonical everywhere else this
    // evidence type is constructed. This fixture predated that requirement.
    const evidence = [
      {
        artifact_id: "ev-gen-1",
        artifact_type: "SPATIAL_EVIDENCE",
        payload: {
          result_semantics: {
            kind: "EXISTENCE_WITHIN_DISTANCE",
            query: {
              subject_ref: { artifact_id: "gen-proof", artifact_type: "PROPERTY" },
              srid: 3006,
              distance_meters: 100,
            },
            result: { exists: true, match_count_observed: 1, max_features_per_layer: 50 },
          },
          source_metadata: { dataset: "water" },
        },
      },
    ] as unknown as SpatialEvidenceArtifact[];

    const lu = await runLuAssessmentViaKernel({
      site_id: "gen-proof",
      deterministic_seed: "seed:gen-lu",
      evidence,
    });
    expect(lu.admitted).toBe(true);
    expect(lu.finding_ids.length).toBeGreaterThan(0);
    expect(lu.attestation).not.toBeNull();
    expect(lu.session).not.toBeNull();
  });

  it("Dummy minimal domain uses the same platform surfaces as LU", async () => {
    const seed = "seed:gen-dummy";
    const harness = createPlatformHarness({
      snapshot_id: "snap-gen-d",
      release_id: "rel-gen-d",
      seed,
      capabilities: [
        {
          artifact_id: "cap-dummy-gen",
          capability_key: "dummy.gen",
          implementation_id: "impl-dummy-gen",
          handler: async () => [{ artifact_id: "dummy-finding" }],
        },
      ],
    });
    const { result } = await runCapabilityOnce(
      harness,
      buildManifest({
        manifest_id: "m-gen-dummy",
        capability_id: "cap-dummy-gen",
        seed,
      }),
    );
    expect(result.admission.decision).toBe("admitted");
    expect(result.capability_executions[0]?.artifact_type).toBe(
      "CAPABILITY_EXECUTION",
    );
  });

  it("Synthetic Workflow proves domain-less multi-step execution", async () => {
    const seed = "seed:gen-syn";
    const harness = createPlatformHarness({
      snapshot_id: "snap-gen-s",
      release_id: "rel-gen-s",
      seed,
      capabilities: [
        {
          artifact_id: "cap-s1",
          capability_key: "syn.1",
          implementation_id: "impl-s1",
          handler: async () => [{ artifact_id: "s1" }],
        },
        {
          artifact_id: "cap-s2",
          capability_key: "syn.2",
          implementation_id: "impl-s2",
          handler: async () => [{ artifact_id: "s2" }],
        },
      ],
      workflows: [
        {
          artifact_id: "wf-gen-syn",
          workflow_key: "syn.gen",
          steps: [
            { step_id: "one", capability_id: "cap-s1" },
            { step_id: "two", capability_id: "cap-s2" },
          ],
        },
      ],
    });
    const { execution } = await runWorkflowOnce(harness, "wf-gen-syn");
    expect(execution.execution_order).toEqual(["one", "two"]);
  });

  it("platform verification harness never imports LU (composition tests may)", () => {
    // Harness + architecture suites must stay domain-agnostic.
    const harnessDir = path.join(verificationRoot, "harness");
    const archDir = path.join(verificationRoot, "architecture");
    const violations: string[] = [];
    for (const dir of [harnessDir, archDir]) {
      for (const file of walkTs(dir)) {
        const src = readFileSync(file, "utf8");
        if (/from\s+['"][^'"]*mps-lu[^'"]*['"]/.test(src)) {
          violations.push(path.relative(verificationRoot, file));
        }
        if (/LURuleEngine/.test(src)) {
          violations.push(path.relative(verificationRoot, file));
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
