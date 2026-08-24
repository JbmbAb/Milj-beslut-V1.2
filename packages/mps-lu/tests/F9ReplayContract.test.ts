import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";

import { runLuAssessmentViaKernel } from "../src/execution/LuExecutionKernelClient";
import type { SpatialEvidenceArtifact } from "../src/artifacts/SpatialEvidenceArtifact";
import { SPATIAL_STACK_V1 } from "../src/artifacts/SpatialEngineFingerprint";
import { DefaultReplayEngine } from "../../mps-runtime/src/replay/DefaultReplayEngine";
import { MimersIntegration } from "../../mps-runtime/src/mimers";
import type {
  ArtifactRepositoryPort,
} from "../../mps-runtime/src/kernel/ExecutionKernel";
import type { ArtifactReference } from "../../mps-compliance/src/artifacts/ArtifactReference";

/**
 * ✅ F9 — REPLAY CONTRACT GREEN PROOF.
 *
 *   Invariant under test:
 *     An assessment SHALL be replayable from captured artifacts alone.
 *
 *   Root cause this closes: `ExecutionKernel.execute()` has always produced a `RuntimeState`
 *   and set `state.attempt` on the admitted path, but `runLuAssessmentViaKernel` did not
 *   surface it. Replay takes `RuntimeState` as its second argument, so the only product
 *   assessment path could not reach replay at all — it failed with
 *   "Replay requires attempt on RuntimeState". The kernel was never wrong; the client dropped
 *   the value on the floor.
 *
 *   Scope: replay reachability and isolation only. F8 (viewer capability admission) is a
 *   separate defect and is deliberately untouched here.
 */
describe("F9 — replay from captured artifacts (GREEN PROOF)", () => {
  // RC8-K: bootstrap admission is opt-in only; no real FrozenCore verification context exists
  // yet, so tests exercising runLuAssessmentViaKernel declare the opt-in explicitly.
  beforeEach(() => {
    process.env.MPS_LU_BOOTSTRAP_ADMIT = "1";
  });
  afterEach(() => {
    delete process.env.MPS_LU_BOOTSTRAP_ADMIT;
  });

  let casRepo: ArtifactRepositoryPort;
  let spatialEvidence: SpatialEvidenceArtifact;

  beforeAll(async () => {
    const mimers = await MimersIntegration.create();
    casRepo = mimers.artifactRepository;

    spatialEvidence = {
      artifact_id: "spatial-f9-1",
      artifact_type: "SPATIAL_EVIDENCE",
      content_hash: { algorithm: "sha256", value: "spatial-hash-f9" },
      references: [{ artifact_id: "prop-f9", artifact_type: "PROPERTY" }],
      payload: {
        result_semantics: {
          kind: "EXISTENCE_WITHIN_DISTANCE",
          query: {
            subject_ref: { artifact_id: "prop-f9", artifact_type: "PROPERTY" },
            srid: 3006,
            distance_meters: 100,
          },
          result: { exists: true, match_count_observed: 1, max_features_per_layer: 50 },
        },
        property_ref: { artifact_id: "prop-f9", artifact_type: "PROPERTY" },
        geometry: null,
        srid: 3006,
        operation: {
          algorithm: "spatial.dwithin_existence",
          engine: "PostGIS",
          engine_fingerprint: SPATIAL_STACK_V1,
        },
        layer_ref: {
          layer_id: "water",
          version_hash: "2b4b514f8b18a1a614d9aeac75c32eff8c52a3864c54770be112fd88fa263ddc",
          layer_version: "v1",
        },
        source_metadata: {
          provider: "SGU",
          dataset: "water",
          dataset_version: "2b4b514f8b18a1a614d9aeac75c32eff8c52a3864c54770be112fd88fa263ddc",
          retrieved_at: "2026-08-13T08:00:00.000Z",
        },
        query_context: {
          query_id: "q-f9",
          query_type: "SPATIAL_DWITHIN",
          parameters: {
            property_ref: { artifact_id: "prop-f9", artifact_type: "PROPERTY" },
            search_distance_meters: 100,
          },
        },
      },
    } as unknown as SpatialEvidenceArtifact;

    await casRepo.put({
      artifact_id: spatialEvidence.artifact_id,
      content_hash: spatialEvidence.content_hash,
      body: spatialEvidence,
    });
  });

  async function runAssessment(siteId: string) {
    return runLuAssessmentViaKernel({
      site_id: siteId,
      deterministic_seed: `seed:${siteId}`,
      evidence: [spatialEvidence],
    });
  }

  it("the assessment run surfaces RuntimeState with a populated attempt", async () => {
    const result = await runAssessment("f9-state");

    expect(result.admitted).toBe(true);
    expect(
      result.state,
      "F9: the kernel produces RuntimeState on every run. Dropping it in the client made replay " +
        "unreachable through the only product assessment path.",
    ).toBeDefined();
    expect(
      result.state.attempt,
      "F9: replay requires state.attempt. This was the exact failure — the kernel set it, the " +
        "client discarded it.",
    ).not.toBeNull();
    expect(result.state.attempt!.attempt_id).toBe(result.attempt_id);
  });

  it("the manifest identity is produced and forwarded consistently", async () => {
    const result = await runAssessment("f9-manifest");

    expect(result.manifest_id).toBe("lu-manifest-f9-manifest");
    expect(
      result.state.manifest?.manifest_id,
      "F9: the manifest carried in RuntimeState must be the same one the caller is told about, " +
        "or replay would be resolving a different execution than the one that ran.",
    ).toBe(result.manifest_id);
    expect(result.state.attempt!.manifest_ref.artifact_id).toBe(result.manifest_id);
  });

  it("replay succeeds from the surfaced state and binds to the original attempt", async () => {
    const result = await runAssessment("f9-replay");

    const replayEngine = new DefaultReplayEngine(casRepo);
    const replay = await replayEngine.replay(
      { artifact_id: result.manifest_id, artifact_type: "execution_manifest" },
      result.state,
    );

    expect(replay.replayed_outcome_ref.artifact_id).toBeDefined();
    expect(
      replay.replayed_outcome_ref.artifact_id,
      "F9: the replayed outcome must be derived from the original attempt, not a fresh one.",
    ).toBe(`outcome-v2-${result.state.attempt!.attempt_id}`);
    expect(replay.equivalence_proof).toBeDefined();
  });

  it("replay resolves ONLY captured artifacts — no live source is reachable", async () => {
    const result = await runAssessment("f9-isolation");

    // A repository that serves nothing but what was captured before replay began, and records
    // every read. If replay needed PostGIS, a provider, or any artifact produced after capture,
    // it could only fail here — it has no other way to obtain one.
    const captured = new Map<string, unknown>();
    const resolved: string[] = [];

    const capturingRepo: ArtifactRepositoryPort = {
      put: async (artifact) => {
        captured.set(artifact.artifact_id, artifact.body);
      },
      resolve: async <T>(ref: ArtifactReference): Promise<T> => {
        resolved.push(ref.artifact_id);
        if (!captured.has(ref.artifact_id)) {
          throw new Error(
            `F9 ISOLATION VIOLATION: replay attempted to resolve '${ref.artifact_id}', which was ` +
              `not captured. Replay must not reach outside the captured set.`,
          );
        }
        return captured.get(ref.artifact_id) as T;
      },
    };

    // The captured set is built from RuntimeState, not by reading a live repository — otherwise
    // the isolation proof would itself depend on a source outside the capture.
    const manifestRef = { artifact_id: result.manifest_id, artifact_type: "execution_manifest" };
    await capturingRepo.put({
      artifact_id: result.manifest_id,
      content_hash: result.state.manifest!.content_hash,
      body: result.state.manifest,
    });

    const replay = await new DefaultReplayEngine(capturingRepo).replay(manifestRef, result.state);

    expect(replay.replayed_outcome_ref.artifact_id).toBeDefined();
    expect(
      resolved,
      "F9: replay must read the manifest from the captured set and nothing beyond it.",
    ).toEqual([result.manifest_id]);
  });

  it("replay is structurally incapable of reaching PostGIS — its only dependency is the repository", () => {
    // Construction-level proof rather than a behavioural one: DefaultReplayEngine takes a single
    // ArtifactRepositoryPort. There is no provider, no connection, no query surface to misuse.
    // A behavioural test could only show that it did not call PostGIS on one path; this shows it
    // has no means to.
    expect(DefaultReplayEngine.length).toBe(1);

    const engine = new DefaultReplayEngine(casRepo);
    const surface = Object.getOwnPropertyNames(Object.getPrototypeOf(engine)).filter(
      (n) => n !== "constructor",
    );
    expect(
      surface,
      "F9: replay exposes only CAS-repository-backed operations. LU-REPLAY-COLD-VERIFY-V1 added " +
        "replayFromManifestId (resolves the attempt from CAS instead of requiring it in memory) -- " +
        "still just repository.resolve() calls, no new dependency surface for a live source to " +
        "enter through.",
    ).toEqual(["replay", "replayFromManifestId"]);
  });

  it("replay fails closed when no attempt exists", async () => {
    const replayEngine = new DefaultReplayEngine(casRepo);

    await expect(
      replayEngine.replay(
        { artifact_id: "lu-manifest-f9-state", artifact_type: "execution_manifest" },
        {
          registry_snapshot: null,
          admission: null,
          manifest: null,
          attempt: null,
          execution_graph: { nodes: [], edges: [] },
          workflow_state: {
            workflow_definition_ref: null,
            current_step_id: null,
            completed_step_ids: [],
            workflow_execution: null,
          },
        },
      ),
      "F9: a run that never produced an attempt has nothing to replay. Fabricating one would " +
        "make replay assert equivalence to an execution that did not happen.",
    ).rejects.toThrow(/attempt/i);
  });
});
