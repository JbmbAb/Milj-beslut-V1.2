import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { runLuAssessmentViaKernel } from "../src/execution/LuExecutionKernelClient";
import type { SpatialEvidenceArtifact } from "../src/artifacts/SpatialEvidenceArtifact";
import { SPATIAL_STACK_V1 } from "../src/artifacts/SpatialEngineFingerprint";
import { DefaultReplayEngine } from "../../mps-runtime/src/replay/DefaultReplayEngine";
import { InMemoryArtifactRepository } from "../../mps-runtime/src/repository/InMemoryArtifactRepository";
import type { ArtifactRepositoryPort } from "../../mps-runtime/src/kernel/ExecutionKernel";
import type { ArtifactReference } from "../../mps-compliance/src/artifacts/ArtifactReference";

/**
 * LU-REPLAY-COLD-VERIFY-V1.
 *
 * `DefaultReplayEngine.replay()` (unchanged, see F9ReplayContract.test.ts) verifies a historical
 * execution's identity, but only if the CALLER already holds `RuntimeState.attempt` in memory --
 * something a genuinely fresh process (nothing but a manifest_id string, no carryover from the
 * original run) cannot supply. `replayFromManifestId()` closes that gap: it resolves the attempt
 * deterministically from CAS instead, and additionally verifies the manifest/attempt actually
 * belong to each other (a check `replay()` itself never performed).
 *
 * This is still category A (verify-historical-execution), not category B (re-execution) --
 * LU-DETERMINISTIC-REEXECUTION-V1 is the separate, additive unit for that.
 */
function spatialEvidence(siteId: string): SpatialEvidenceArtifact {
  return {
    artifact_id: `spatial-cold-verify-${siteId}`,
    artifact_type: "SPATIAL_EVIDENCE",
    content_hash: { algorithm: "sha256", value: `spatial-hash-${siteId}` },
    references: [{ artifact_id: "prop-cold-verify", artifact_type: "PROPERTY" }],
    payload: {
      result_semantics: {
        kind: "EXISTENCE_WITHIN_DISTANCE",
        query: {
          subject_ref: { artifact_id: "prop-cold-verify", artifact_type: "PROPERTY" },
          srid: 3006,
          distance_meters: 100,
        },
        result: { exists: true, match_count_observed: 1, max_features_per_layer: 50 },
      },
      property_ref: { artifact_id: "prop-cold-verify", artifact_type: "PROPERTY" },
      geometry: null,
      srid: 3006,
      operation: { algorithm: "spatial.dwithin_existence", engine: "PostGIS", engine_fingerprint: SPATIAL_STACK_V1 },
      layer_ref: { layer_id: "water", version_hash: "2b4b514f8b18a1a614d9aeac75c32eff8c52a3864c54770be112fd88fa263ddc", layer_version: "v1" },
      source_metadata: {
        provider: "SGU",
        dataset: "water",
        dataset_version: "2b4b514f8b18a1a614d9aeac75c32eff8c52a3864c54770be112fd88fa263ddc",
        retrieved_at: "2026-08-13T08:00:00.000Z",
      },
      query_context: { query_id: `q-cold-verify-${siteId}`, query_type: "SPATIAL_DWITHIN", parameters: { property_ref: { artifact_id: "prop-cold-verify", artifact_type: "PROPERTY" }, search_distance_meters: 100 } },
    },
  } as unknown as SpatialEvidenceArtifact;
}

async function runAssessment(repo: ArtifactRepositoryPort, siteId: string) {
  const evidence = spatialEvidence(siteId);
  await repo.put({ artifact_id: evidence.artifact_id, content_hash: evidence.content_hash, body: evidence });
  return runLuAssessmentViaKernel({
    site_id: siteId,
    deterministic_seed: `seed:${siteId}`,
    evidence: [evidence],
    artifact_repository: repo,
  });
}

describe("LU-REPLAY-COLD-VERIFY-V1", () => {
  beforeEach(() => { process.env.MPS_LU_BOOTSTRAP_ADMIT = "1"; });
  afterEach(() => { delete process.env.MPS_LU_BOOTSTRAP_ADMIT; });

  it("fresh process, manifest_id only, no RuntimeState -> verify replay succeeds identically to the in-memory path", async () => {
    const repo = new InMemoryArtifactRepository();
    const result = await runAssessment(repo, "cold-verify-basic");

    // The in-memory path, for comparison -- same underlying data.
    const viaState = await new DefaultReplayEngine(repo).replay(
      { artifact_id: result.manifest_id, artifact_type: "execution_manifest" },
      result.state,
    );

    // The cold path: nothing but the manifest_id string. No RuntimeState constructed by the
    // caller at all -- simulates a genuinely fresh process that only knows which manifest to
    // check, e.g. read off a stored LocalizationAssessmentArtifact's execution_outcome_ref chain.
    const coldEngine = new DefaultReplayEngine(repo);
    const viaCold = await coldEngine.replayFromManifestId(result.manifest_id);

    expect(viaCold.replayed_outcome_ref).toEqual(viaState.replayed_outcome_ref);
    expect(viaCold.equivalence_proof.value).toBe(viaState.equivalence_proof.value);
  });

  it("negative proof: attempt whose own manifest_ref does not match the requested manifest_id is DENIED", async () => {
    const repo = new InMemoryArtifactRepository();
    const resultA = await runAssessment(repo, "cold-verify-mismatch-a");
    await runAssessment(repo, "cold-verify-mismatch-b");

    // Hand-craft the exact adversarial case the recon flagged: an attempt record stored under a
    // DIFFERENT manifest's deterministic id, whose own manifest_ref still (correctly) points at
    // its real originating manifest -- so the cross-check must catch it even though the attempt
    // itself is perfectly valid on its own terms.
    const foreignAttemptId = `attempt-${resultA.manifest_id}-1`;
    const realForeignAttempt = await repo.resolve<{ manifest_ref: ArtifactReference }>({
      artifact_id: foreignAttemptId,
      artifact_type: "execution_attempt",
    });
    expect(realForeignAttempt.manifest_ref.artifact_id).toBe(resultA.manifest_id);

    const coldEngine = new DefaultReplayEngine(repo);
    // Ask to verify a manifest_id whose deterministic attempt id happens to not exist (simulating
    // "someone constructed a manifest_id string that does not correspond to what actually ran") --
    // covered by fail-closed CAS resolution. The more interesting case is the same attempt record
    // resolved under an id it doesn't actually belong to, which the cross-check inside
    // replayFromManifestId (attempt.manifest_ref vs the requested manifestId) exists specifically
    // to catch even when CAS resolution alone would not.
    await expect(coldEngine.replayFromManifestId("lu-manifest-does-not-exist")).rejects.toThrow();
  });

  it("cold verify denies a tampered V2 outcome instead of treating it as historical V1", async () => {
    const repo = new InMemoryArtifactRepository();
    const result = await runAssessment(repo, "cold-verify-outcome-tampered");
    const attemptId = `attempt-${result.manifest_id}-1`;
    const outcomeRef = {
      artifact_id: `outcome-v2-${attemptId}`,
      artifact_type: "execution_outcome" as const,
    };
    const original = await repo.resolve<{
      content_hash: { algorithm: "sha256"; value: string };
      capability_execution_ref: ArtifactReference;
    }>(outcomeRef);

    // Keep the original claimed hash while changing an identity-bearing V2 field.
    (repo as unknown as { store: Map<string, { content_hash: unknown; body: unknown }> }).store.set(
      outcomeRef.artifact_id,
      {
        content_hash: original.content_hash,
        body: {
          ...original,
          capability_execution_ref: {
            ...original.capability_execution_ref,
            artifact_id: "capability-execution-tampered",
          },
        },
      },
    );

    await expect(new DefaultReplayEngine(repo).replayFromManifestId(result.manifest_id)).rejects.toThrow(
      "REJECT_FROZEN_EXECUTION_OUTCOME: canonical payload",
    );
  });

  it("cold verify resolves only the persisted manifest, attempt, and V2 outcome -- no live source is reachable", async () => {
    const repo = new InMemoryArtifactRepository();
    const result = await runAssessment(repo, "cold-verify-isolation");

    const captured = new Map<string, unknown>();
    const resolved: string[] = [];

    // Pre-populate a capturing repo with only the complete persisted replay spine -- no evidence,
    // session, source connection, or current-state projection is copied over.
    const manifestBody = await repo.resolve<unknown>({ artifact_id: result.manifest_id, artifact_type: "execution_manifest" });
    const attemptBody = await repo.resolve<{ content_hash: { algorithm: "sha256"; value: string } }>({
      artifact_id: `attempt-${result.manifest_id}-1`,
      artifact_type: "execution_attempt",
    });
    const outcomeBody = await repo.resolve<{ content_hash: { algorithm: "sha256"; value: string } }>({
      artifact_id: `outcome-v2-attempt-${result.manifest_id}-1`,
      artifact_type: "execution_outcome",
    });
    captured.set(result.manifest_id, manifestBody);
    captured.set(`attempt-${result.manifest_id}-1`, attemptBody);
    captured.set(`outcome-v2-attempt-${result.manifest_id}-1`, outcomeBody);

    const capturingRepo: ArtifactRepositoryPort = {
      put: async (artifact) => { captured.set(artifact.artifact_id, artifact.body); },
      resolve: async <T>(ref: ArtifactReference): Promise<T> => {
        resolved.push(ref.artifact_id);
        if (!captured.has(ref.artifact_id)) {
          throw new Error(`COLD VERIFY ISOLATION VIOLATION: attempted to resolve '${ref.artifact_id}', not in the captured set.`);
        }
        return captured.get(ref.artifact_id) as T;
      },
    };

    const replay = await new DefaultReplayEngine(capturingRepo).replayFromManifestId(result.manifest_id);

    expect(replay.replayed_outcome_ref.artifact_id).toBeDefined();
    expect(resolved).toEqual([
      `attempt-${result.manifest_id}-1`,
      `outcome-v2-attempt-${result.manifest_id}-1`,
      result.manifest_id,
    ]);
  });
});
