import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  LuCanonicalRuntimeContractError,
  evaluateLuRuleSet,
  runCanonicalLuProductAssessment,
  runLuAssessmentViaKernel,
} from "../src/execution/LuExecutionKernelClient";
import {
  SPATIAL_LAYER_UNAVAILABLE,
  createSpatialLayerUnavailableEvidence,
  isSpatialLayerUnavailableEvidenceValid,
  toSpatialLayerUnavailable,
} from "../src/artifacts/SpatialLayerUnavailableEvidence";
import { SPATIAL_CANONICAL_VERSION_V3, SPATIAL_QUERY_CONTRACT_V3, type SpatialQueryContractV3 } from "../src/services/SpatialQueryContract";
import { InMemoryArtifactRepository } from "../../mps-runtime/src/repository/InMemoryArtifactRepository";
import { sha256ContentHash } from "../../mps-runtime/src/kernel/ExecutionKernel";

/**
 * U30-R (LU 72h): the pinned cause of a NOT_CHECKED finding -- identity, rule-engine citation,
 * kernel verification and the canonical product boundary. Hermetic: in-memory CAS only.
 */

const PROPERTY_REF = { artifact_id: "prop-u30r", artifact_type: "PROPERTY" };
const LOCATION_REF = { artifact_id: "localization-geometry-u30r", artifact_type: "localization_geometry" };
const EBH_HASH = "02fccffc07abaaf1775c8333d660fa60fdecea0c3bb664335892764c8486d186";

function queryContract(withLocation: boolean): SpatialQueryContractV3 {
  return {
    query_contract_version: SPATIAL_QUERY_CONTRACT_V3,
    spatial_canonical_version: SPATIAL_CANONICAL_VERSION_V3,
    relation: "DWITHIN",
    subject: withLocation
      ? { kind: "LOCALIZATION_GEOMETRY", property_context_ref: PROPERTY_REF, location_ref: LOCATION_REF, crs: "EPSG:3006" }
      : { kind: "PROPERTY_CONTEXT_CENTROID", property_context_ref: PROPERTY_REF, crs: "EPSG:3006" },
    parameters: { distance_meters: 500, max_features_per_layer: 50 },
    selection: { predicate_semantics: "EXISTS" },
  };
}

function cause(reason = "QueryFailedError: simulated", withLocation = true) {
  return createSpatialLayerUnavailableEvidence({
    layer_id: "ebh",
    version_hash: EBH_HASH,
    layer_version: "v1.0",
    provider: "SGU",
    query_contract: queryContract(withLocation),
    reason,
  });
}

describe("U30-R: SPATIAL_LAYER_UNAVAILABLE identity", () => {
  it("is content-addressed over {artifact_type, references, payload} with RFC8785/sha256 and carries no wall-clock value", () => {
    const artifact = cause();
    const expected = sha256ContentHash({ artifact_type: SPATIAL_LAYER_UNAVAILABLE, references: artifact.references, payload: artifact.payload });
    expect(artifact.content_hash).toEqual(expected);
    expect(artifact.artifact_id).toBe(`layer-unavailable-ebh-${expected.value.slice(0, 24)}`);
    expect(artifact.references).toEqual([PROPERTY_REF, LOCATION_REF]);
    expect(JSON.stringify(artifact.payload)).not.toMatch(/retrieved_at|_at"|time/i);
    expect(isSpatialLayerUnavailableEvidenceValid(artifact)).toBe(true);
  });

  it("is deterministic, and the reason, layer hash and subject are all identity inputs", () => {
    expect(cause().artifact_id).toBe(cause().artifact_id);
    expect(cause("other reason").artifact_id).not.toBe(cause().artifact_id);
    expect(cause(undefined, false).artifact_id).not.toBe(cause().artifact_id);
  });

  it("a rewritten payload or a foreign id is not self-consistent", () => {
    const artifact = cause();
    expect(isSpatialLayerUnavailableEvidenceValid({ ...artifact, payload: { ...artifact.payload, provider: "x" } })).toBe(false);
    expect(isSpatialLayerUnavailableEvidenceValid({ ...artifact, artifact_id: "layer-unavailable-ebh-forged" })).toBe(false);
    expect(isSpatialLayerUnavailableEvidenceValid({ ...artifact, artifact_type: "SPATIAL_EVIDENCE" })).toBe(false);
  });

  it("refuses to mint without layer, registry hash, provider or reason", () => {
    expect(() => createSpatialLayerUnavailableEvidence({ layer_id: "ebh", version_hash: "", layer_version: "v1.0", provider: "SGU", query_contract: queryContract(true), reason: "x" })).toThrow(/version_hash is required/);
    expect(() => createSpatialLayerUnavailableEvidence({ layer_id: "ebh", version_hash: EBH_HASH, layer_version: "v1.0", provider: "SGU", query_contract: queryContract(true), reason: " " })).toThrow(/reason is required/);
  });
});

describe("U30-R: the NOT_CHECKED finding cites its pinned cause", () => {
  it("same finding id, rule, version, risk and wording as before; evidence_refs = [cause]", () => {
    const artifact = cause();
    const [pinned] = evaluateLuRuleSet([], [], [], [toSpatialLayerUnavailable(artifact)]);
    const [legacy] = evaluateLuRuleSet([], [], [], [{ dataset: "ebh", reason: "QueryFailedError: simulated" }]);
    expect(pinned).toEqual({ ...legacy, evidence_refs: [{ artifact_id: artifact.artifact_id, artifact_type: SPATIAL_LAYER_UNAVAILABLE }] });
    expect(legacy!.evidence_refs).toEqual([]);
  });
});

describe("U30-R: kernel verification of pinned causes", () => {
  beforeEach(() => {
    process.env.MPS_LU_BOOTSTRAP_ADMIT = "1";
  });
  afterEach(() => {
    delete process.env.MPS_LU_BOOTSTRAP_ADMIT;
  });

  function draft(siteId: string) {
    return {
      site_id: siteId,
      project_context_ref: { artifact_id: "lu_project_context-u30r", artifact_type: "LU_PROJECT_CONTEXT" },
      property_ref: PROPERTY_REF,
      evidence_refs: [],
      system_summary: "U30-R kernel verification",
    };
  }

  it("a cause whose recorded reason differs from the declared entry is refused before anything is written", async () => {
    const repo = new InMemoryArtifactRepository();
    const artifact = cause();
    await repo.put({ artifact_id: artifact.artifact_id, content_hash: artifact.content_hash, body: artifact });
    const store = (repo as unknown as { store: Map<string, unknown> }).store;
    const before = store.size;

    await expect(
      runLuAssessmentViaKernel({
        site_id: "u30r-mismatch",
        deterministic_seed: "seed:u30r-mismatch",
        evidence: [],
        unavailable_layers: [{ dataset: "ebh", reason: "a different reason", evidence_ref: { artifact_id: artifact.artifact_id, artifact_type: SPATIAL_LAYER_UNAVAILABLE } }],
        artifact_repository: repo,
        assessment_draft: draft("u30r-mismatch"),
      }),
    ).rejects.toThrow(/REJECT_LU_UNAVAILABLE_LAYER_CAUSE: .* does not record layer "ebh" with the declared reason/);
    expect(store.size).toBe(before);
  });

  it("a cause that is not in the run's repository is refused", async () => {
    const repo = new InMemoryArtifactRepository();
    const artifact = cause();
    await expect(
      runLuAssessmentViaKernel({
        site_id: "u30r-absent",
        deterministic_seed: "seed:u30r-absent",
        evidence: [],
        unavailable_layers: [toSpatialLayerUnavailable(artifact)],
        artifact_repository: repo,
        assessment_draft: draft("u30r-absent"),
      }),
    ).rejects.toThrow(/REJECT_LU_UNAVAILABLE_LAYER_CAUSE: .* is not in the artifact repository/);
  });

  it("a verified cause is pinned in the assessment's evidence set and cited by its finding", async () => {
    const repo = new InMemoryArtifactRepository();
    const artifact = cause();
    await repo.put({ artifact_id: artifact.artifact_id, content_hash: artifact.content_hash, body: artifact });
    const ref = { artifact_id: artifact.artifact_id, artifact_type: SPATIAL_LAYER_UNAVAILABLE };

    const run = await runLuAssessmentViaKernel({
      site_id: "u30r-pinned",
      deterministic_seed: "seed:u30r-pinned",
      evidence: [],
      unavailable_layers: [toSpatialLayerUnavailable(artifact)],
      artifact_repository: repo,
      assessment_draft: draft("u30r-pinned"),
    });

    expect(run.assessment!.payload.evidence_refs).toEqual([ref]);
    expect(run.assessment!.payload.findings).toEqual([expect.objectContaining({ finding_id: "finding-notchecked-ebh", risk_level: "NOT_CHECKED", evidence_refs: [ref] })]);
  });
});

describe("U30-R: canonical product boundary", () => {
  it("refuses an unavailable layer without a pinned cause, before the engine is entered", async () => {
    delete process.env.MPS_LU_BOOTSTRAP_ADMIT;
    const call = runCanonicalLuProductAssessment({
      site_id: "u30r-canonical",
      deterministic_seed: "seed:u30r-canonical",
      evidence: [],
      unavailable_layers: [{ dataset: "ebh", reason: "QueryFailedError: simulated" }],
      artifact_repository: new InMemoryArtifactRepository(),
      identity_subject_v3: {
        project_context_binding_ref: { artifact_id: "pcb-1", artifact_type: "PROJECT_CONTEXT_BINDING" },
        product_release_ref: { artifact_id: "release-1", artifact_type: "PRODUCT_RELEASE" },
        execution_contract_version: "lu-execution-v3",
        localization_geometry_ref: LOCATION_REF,
      },
    });
    await expect(call).rejects.toBeInstanceOf(LuCanonicalRuntimeContractError);
    await expect(call).rejects.toMatchObject({ code: "LU_CANONICAL_UNAVAILABLE_LAYER_CAUSE_NOT_PINNED" });
  });
});
