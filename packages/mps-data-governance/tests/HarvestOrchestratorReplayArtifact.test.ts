// packages/mps-data-governance/tests/HarvestOrchestratorReplayArtifact.test.ts

import { describe, test, expect } from "vitest";
import { ReplayEngine } from "../src/ReplayEngine";
import { buildExecutionManifest } from "../src/ExecutionManifest";
import type { HarvestExecutionCheckpoint, HarvestExecutionState } from "../src/HarvestOrchestratorTypes";

const contentRef = (hash: string) => ({ content_hash: { algorithm: "sha256", digest: hash }, id: hash });
const artifactRef = (id: string, hash: string) => ({ id, content_hash: { algorithm: "sha256", digest: hash } });

const dataset_ref = contentRef("dataset");
const requested_at = "2026-01-01T00:00:00.000Z";

const baseCheckpoint: HarvestExecutionCheckpoint = {
  checkpoint_version: 1,
  execution_id: "exec-1",
  updated_at: "2026-01-01T00:00:00.000Z",
  state: "READY_FOR_LU",
  manifest_ref: contentRef("manifest"),
  verification_ref: artifactRef("verification", "vhash"),
  approval_ref: artifactRef("approval", "ahash"),
  gate_evidence_ref: artifactRef("gate", "ghash"),
  projection_ref: artifactRef("projection", "phash"),
  lu_ref: artifactRef("lu", "lhash"),
  archive_refs: [contentRef("manifest")],
  compliance_results: [],
};

describe("HarvestOrchestratorReplayArtifact — ReplayEngine consumes lineage only", () => {

  // ---------------------------------------------------------------------------
  // 1. Replay SHALL NOT generate new artifacts
  // ---------------------------------------------------------------------------

  test("Replay returns exactly the artifacts stored in manifest", () => {
    const manifest = buildExecutionManifest(baseCheckpoint, dataset_ref, requested_at);
    const result = ReplayEngine.replay(manifest);

    expect(result.evidence_refs).toEqual([
      artifactRef("verification", "vhash"),
      artifactRef("approval", "ahash"),
      artifactRef("gate", "ghash"),
      artifactRef("projection", "phash"),
      artifactRef("lu", "lhash"),
    ]);

    expect(result.produced_artifacts).toEqual([
      artifactRef("projection", "phash"),
      artifactRef("lu", "lhash"),
    ]);
  });

  // ---------------------------------------------------------------------------
  // 2. manifest_ref och archive_refs får ALDRIG bli produced_artifacts
  // ---------------------------------------------------------------------------

  test("manifest_ref and archive_refs are NOT produced artifacts", () => {
    const manifest = buildExecutionManifest(baseCheckpoint, dataset_ref, requested_at);
    const result = ReplayEngine.replay(manifest);

    expect(result.produced_artifacts).not.toContainEqual(contentRef("manifest"));
    expect(result.produced_artifacts).not.toContainEqual(contentRef("dataset"));
  });

  // ---------------------------------------------------------------------------
  // 3. Replay SHALL NOT modify timestamps
  // ---------------------------------------------------------------------------

  test("Replay preserves updated_at exactly", () => {
    const manifest = buildExecutionManifest(baseCheckpoint, dataset_ref, requested_at);
    const result = ReplayEngine.replay(manifest);

    expect(manifest.updated_at).toBe("2026-01-01T00:00:00.000Z");
  });

  // ---------------------------------------------------------------------------
  // 4. Replay SHALL preserve state exactly
  // ---------------------------------------------------------------------------

  const states: HarvestExecutionState[] = [
    "READY_FOR_LU",
    "BLOCKED",
    "ARCHIVED",
    "QUARANTINED",
    "AWAITING_APPROVAL",
  ];

  for (const state of states) {
    test(`Replay preserves state '${state}'`, () => {
      const cp = { ...baseCheckpoint, state };
      const manifest = buildExecutionManifest(cp, dataset_ref, requested_at);
      const result = ReplayEngine.replay(manifest);

      expect(result.state).toBe(state);
    });
  }

  // ---------------------------------------------------------------------------
  // 5. Replay SHALL NOT invent artifacts when lineage is missing
  // ---------------------------------------------------------------------------

  test("Replay does not invent artifacts when lineage is missing", () => {
    const cp = {
      ...baseCheckpoint,
      projection_ref: undefined,
      lu_ref: undefined,
      gate_evidence_ref: undefined,
      approval_ref: undefined,
    };
    const manifest = buildExecutionManifest(cp, dataset_ref, requested_at);
    const result = ReplayEngine.replay(manifest);

    expect(result.produced_artifacts).toEqual([]);
    expect(result.evidence_refs).toEqual([
      artifactRef("verification", "vhash"),
    ]);
  });

  // ---------------------------------------------------------------------------
  // 6. Replay SHALL NOT bypass governance boundary
  // ---------------------------------------------------------------------------

  test("Replay from VERIFIED returns only verification evidence", () => {
    const cp = {
      ...baseCheckpoint,
      state: "VERIFIED" as const,
      approval_ref: undefined,
      gate_evidence_ref: undefined,
      projection_ref: undefined,
      lu_ref: undefined,
    };
    const manifest = buildExecutionManifest(cp, dataset_ref, requested_at);
    const result = ReplayEngine.replay(manifest);

    expect(result.state).toBe("VERIFIED");
    expect(result.evidence_refs).toEqual([
      artifactRef("verification", "vhash"),
    ]);
    expect(result.produced_artifacts).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // 7. Replay SHALL be deterministic
  // ---------------------------------------------------------------------------

  test("Replay is deterministic: same manifest → same result", () => {
    const manifest = buildExecutionManifest(baseCheckpoint, dataset_ref, requested_at);
    const r1 = ReplayEngine.replay(manifest);
    const r2 = ReplayEngine.replay(manifest);
    const r3 = ReplayEngine.replay(manifest);

    expect(r1).toEqual(r2);
    expect(r2).toEqual(r3);
  });
});
