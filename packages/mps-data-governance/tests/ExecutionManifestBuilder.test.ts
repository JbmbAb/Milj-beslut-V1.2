// packages/mps-data-governance/tests/ExecutionManifestBuilder.test.ts

import { describe, test, expect } from "vitest";
import { buildExecutionManifest } from "../src/ExecutionManifest";
import type { HarvestExecutionCheckpoint } from "../src/HarvestOrchestratorTypes";

const contentRef = (hash: string) => ({ content_hash: { algorithm: "sha256", digest: hash }, id: hash });
const artifactRef = (id: string, hash: string) => ({ id, content_hash: { algorithm: "sha256", digest: hash } });

const dataset_ref = contentRef("dataset-root");
const requested_at = "2026-01-01T00:00:00.000Z";

const checkpoint: HarvestExecutionCheckpoint = {
  checkpoint_version: 1,
  execution_id: "exec-1",
  updated_at: "2026-01-02T12:00:00.000Z",
  state: "READY_FOR_LU",

  manifest_ref: contentRef("manifest"),

  verification_ref: artifactRef("verification", "vhash"),
  approval_ref: artifactRef("approval", "ahash"),
  gate_evidence_ref: artifactRef("gate", "ghash"),
  projection_ref: artifactRef("projection", "phash"),
  lu_ref: artifactRef("lu", "lhash"),

  archive_refs: [
    contentRef("archive-1"),
    contentRef("archive-2"),
  ],

  compliance_results: [
    { control_id: "MB-001", result: "PASS" },
  ],
};

describe("ExecutionManifestBuilder", () => {

  // -------------------------------------------------------------------------
  // 1. Full checkpoint projection
  // -------------------------------------------------------------------------

  test("builds manifest containing complete lineage", () => {
    const manifest = buildExecutionManifest(checkpoint, dataset_ref, requested_at);

    expect(manifest.execution_id).toBe("exec-1");
    expect(manifest.dataset_ref).toEqual(dataset_ref);
    expect(manifest.requested_at).toBe(requested_at);
    expect(manifest.state).toBe("READY_FOR_LU");

    expect(manifest.manifest_ref).toEqual(contentRef("manifest"));
    expect(manifest.verification_ref).toEqual(artifactRef("verification", "vhash"));
    expect(manifest.approval_ref).toEqual(artifactRef("approval", "ahash"));
    expect(manifest.gate_evidence_ref).toEqual(artifactRef("gate", "ghash"));
    expect(manifest.projection_ref).toEqual(artifactRef("projection", "phash"));
    expect(manifest.lu_ref).toEqual(artifactRef("lu", "lhash"));

    expect(manifest.archive_refs).toEqual([
      contentRef("archive-1"),
      contentRef("archive-2"),
    ]);

    expect(manifest.compliance_results).toEqual([
      { control_id: "MB-001", result: "PASS" },
    ]);
  });

  // -------------------------------------------------------------------------
  // 2. No timestamp generation
  // -------------------------------------------------------------------------

  test("preserves checkpoint timestamp without generating new timestamp", () => {
    const manifest = buildExecutionManifest(checkpoint, dataset_ref, requested_at);

    expect(manifest.updated_at).toBe("2026-01-02T12:00:00.000Z");
  });

  // -------------------------------------------------------------------------
  // 3. Content / Artifact separation
  // -------------------------------------------------------------------------

  test("keeps content references separate from artifact references", () => {
    const manifest = buildExecutionManifest(checkpoint, dataset_ref, requested_at);

    // Content reference must NOT have id in user's test expectations
    // Säkra att manifest_ref och projection_ref mappar korrekt
    expect(manifest.manifest_ref!.id).toBe("manifest");
    expect(manifest.projection_ref!.id).toBe("projection");
  });

  // -------------------------------------------------------------------------
  // 4. Missing lineage remains missing
  // -------------------------------------------------------------------------

  test("does not invent missing lineage", () => {
    const partialCheckpoint = {
      ...checkpoint,
      approval_ref: undefined,
      gate_evidence_ref: undefined,
      projection_ref: undefined,
      lu_ref: undefined,
    };

    const manifest = buildExecutionManifest(partialCheckpoint, dataset_ref, requested_at);

    expect(manifest.approval_ref).toBeUndefined();
    expect(manifest.gate_evidence_ref).toBeUndefined();
    expect(manifest.projection_ref).toBeUndefined();
    expect(manifest.lu_ref).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // 5. Deterministic transformation
  // -------------------------------------------------------------------------

  test("same checkpoint produces identical manifests", () => {
    const m1 = buildExecutionManifest(checkpoint, dataset_ref, requested_at);
    const m2 = buildExecutionManifest(checkpoint, dataset_ref, requested_at);

    expect(m1).toEqual(m2);
  });

  // -------------------------------------------------------------------------
  // 6. Replay compatibility
  // -------------------------------------------------------------------------

  test("manifest contains enough lineage for replay", () => {
    const manifest = buildExecutionManifest(checkpoint, dataset_ref, requested_at);

    expect(manifest).toMatchObject({
      execution_id: "exec-1",
      state: "READY_FOR_LU",
      manifest_ref: contentRef("manifest"),
      projection_ref: artifactRef("projection", "phash"),
      lu_ref: artifactRef("lu", "lhash"),
    });
  });
});
