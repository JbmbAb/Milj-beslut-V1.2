// packages/mps-data-governance/tests/HarvestOrchestratorReplayArtifact.test.ts

import { describe, test, expect } from "vitest";
import { ReplayEngine } from "../src/ReplayEngine";
import { buildExecutionManifest } from "../src/ExecutionManifest";
import type { HarvestExecutionCheckpoint, HarvestExecutionState } from "../src/HarvestOrchestratorTypes";

const contentRef = (hash: string) => ({ content_hash: { algorithm: "sha256", digest: hash }, id: hash });
const artifactRef = (id: string, hash: string, artifact_type = id.toUpperCase()) => ({
  artifact_id: id,
  artifact_type,
  content_hash: { algorithm: "sha256", digest: hash },
});

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

describe("HarvestOrchestratorReplayArtifact — ReplayEngine Lineage Consistency", () => {

  // ---------------------------------------------------------------------------
  // POSITIVE PATHS: Giltig och konsekvent lineage accepteras deterministiskt
  // ---------------------------------------------------------------------------
  describe("Positive Paths (Valid Dynamic Lineage)", () => {
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

    test("manifest_ref and archive_refs are NOT produced artifacts", () => {
      const manifest = buildExecutionManifest(baseCheckpoint, dataset_ref, requested_at);
      const result = ReplayEngine.replay(manifest);

      expect(result.produced_artifacts).not.toContainEqual(contentRef("manifest"));
      expect(result.produced_artifacts).not.toContainEqual(contentRef("dataset"));
    });

    test("Replay preserves updated_at and state exactly", () => {
      const manifest = buildExecutionManifest(baseCheckpoint, dataset_ref, requested_at);
      const result = ReplayEngine.replay(manifest);

      expect(manifest.updated_at).toBe("2026-01-01T00:00:00.000Z");
      expect(result.state).toBe("READY_FOR_LU");
    });

    const consistentStates: HarvestExecutionState[] = [
      "READY_FOR_LU",
      "BLOCKED",
      "ARCHIVED",
      "QUARANTINED",
      "AWAITING_APPROVAL",
    ];

    for (const state of consistentStates) {
      test(`Replay preserves state '${state}' with consistent lineage`, () => {
        const cp = { ...baseCheckpoint, state };
        
        if (state === "AWAITING_APPROVAL" || state === "QUARANTINED") {
          (cp as any).approval_ref = undefined;
          (cp as any).gate_evidence_ref = undefined;
          (cp as any).projection_ref = undefined;
          (cp as any).lu_ref = undefined;
        } else if (state === "BLOCKED") {
          (cp as any).projection_ref = undefined;
          (cp as any).lu_ref = undefined;
        }

        const manifest = buildExecutionManifest(cp, dataset_ref, requested_at);
        const result = ReplayEngine.replay(manifest);

        expect(result.state).toBe(state);
      });
    }

    test("Replay is deterministic: same manifest → same result", () => {
      const manifest = buildExecutionManifest(baseCheckpoint, dataset_ref, requested_at);
      const r1 = ReplayEngine.replay(manifest);
      const r2 = ReplayEngine.replay(manifest);

      expect(r1).toEqual(r2);
    });
  });

  // ---------------------------------------------------------------------------
  // NEGATIVE PATHS: Manipulerad eller inkonsekvent lineage avvisas hårt
  // ---------------------------------------------------------------------------
  describe("Negative Paths (Lineage Consistency Violations - assertLineageConsistency)", () => {
    test("Rejects post-governance approval artifacts in AWAITING_APPROVAL state", () => {
      const manipulatedCp = {
        ...baseCheckpoint,
        state: "AWAITING_APPROVAL" as const,
        // En pågående granskning får ALDRIG innehålla ett färdigt godkännande (Violates boundary!)
        approval_ref: artifactRef("approval", "ahash"),
      };

      const manifest = buildExecutionManifest(manipulatedCp, dataset_ref, requested_at);

      expect(() => {
        ReplayEngine.replay(manifest);
      }).toThrow("governance boundary violated for AWAITING_APPROVAL");
    });

    test("Rejects approval or gate evidence artifacts in VERIFIED state", () => {
      const manipulatedCp = {
        ...baseCheckpoint,
        state: "VERIFIED" as const,
        // VERIFIED får aldrig innehålla efterföljande beslut
        gate_evidence_ref: artifactRef("gate", "ghash"),
      };

      const manifest = buildExecutionManifest(manipulatedCp, dataset_ref, requested_at);

      expect(() => {
        ReplayEngine.replay(manifest);
      }).toThrow("VERIFIED state contains post-governance artifacts");
    });

    test("Rejects terminal states containing approval but missing verification (monotonicity check)", () => {
      const manipulatedCp = {
        ...baseCheckpoint,
        state: "BLOCKED" as const,
        verification_ref: undefined, // Fel! Godkännande finns men inte verifiering!
        approval_ref: artifactRef("approval", "ahash"),
      };

      const manifest = buildExecutionManifest(manipulatedCp, dataset_ref, requested_at);

      expect(() => {
        ReplayEngine.replay(manifest);
      }).toThrow("approval without verification in terminal state");
    });

    test("Rejects terminal states containing projection but missing gate evidence (monotonicity check)", () => {
      const manipulatedCp = {
        ...baseCheckpoint,
        state: "BLOCKED" as const,
        gate_evidence_ref: undefined, // Fel! Projektion finns men dörrvaktsbevis saknas!
        projection_ref: artifactRef("projection", "phash"),
      };

      const manifest = buildExecutionManifest(manipulatedCp, dataset_ref, requested_at);

      expect(() => {
        ReplayEngine.replay(manifest);
      }).toThrow("projection/LU without gate evidence in terminal state");
    });
  });
});
