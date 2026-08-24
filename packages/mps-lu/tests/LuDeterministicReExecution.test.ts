import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { runLuAssessmentViaKernel } from "../src/execution/LuExecutionKernelClient";
import { reExecuteLocalizationAssessment } from "../src/execution/LuDeterministicReExecution";
import type { SpatialEvidenceArtifact } from "../src/artifacts/SpatialEvidenceArtifact";
import { SPATIAL_STACK_V1 } from "../src/artifacts/SpatialEngineFingerprint";
import { buildSpatialEvidenceContentHash } from "../src/artifacts/SpatialEvidenceIdentity";
import { InMemoryArtifactRepository } from "../../mps-runtime/src/repository/InMemoryArtifactRepository";
import { sha256ContentHash, type ArtifactRepositoryPort } from "../../mps-runtime/src/kernel/ExecutionKernel";
import type { LocalizationAssessmentArtifact, LocalizationAssessmentDraft } from "../src/artifacts/LocalizationAssessmentArtifact";

/** Rebuilds artifact_id/content_hash for a hand-tampered payload using the exact same formula
 *  createGovernedLocalizationAssessment uses -- makes the tampered artifact internally
 *  self-consistent (its own hash matches its own bytes), so tests can isolate what they're
 *  actually probing (findings/rule_refs/contract-version comparison) from the separate
 *  self-consistency check reExecuteLocalizationAssessment performs first. */
function reselfHash(assessment: LocalizationAssessmentArtifact): LocalizationAssessmentArtifact {
  const identityBody = { artifact_type: assessment.artifact_type, references: assessment.references, payload: assessment.payload };
  return { ...assessment, content_hash: sha256ContentHash(identityBody) };
}

/**
 * LU-DETERMINISTIC-REEXECUTION-V1.
 *
 * Category B (re-execute-deterministically) -- explicitly separate from
 * DefaultReplayEngine.replay()/replayFromManifestId() (category A, unchanged). Covers the
 * owner-required proof matrix items that are meaningfully expressible as fast, deterministic
 * unit proofs (09-16); the environmental/hostile-condition items (01-08) are covered live
 * against the real dev CAS in scripts/ops/prove-lu-deterministic-reexecution-01.ts, matching the
 * established pattern for this class of proof this session.
 */
function spatialEvidence(siteId: string, layer: "water" | "ebh" = "water"): SpatialEvidenceArtifact {
  const versionHash = layer === "water" ? "2b4b514f8b18a1a614d9aeac75c32eff8c52a3864c54770be112fd88fa263ddc" : "02fccffc07abaaf1775c8333d660fa60fdecea0c3bb664335892764c8486d186";
  const payload = {
    result_semantics: {
      kind: "EXISTENCE_WITHIN_DISTANCE",
      query: { subject_ref: { artifact_id: "prop-reexec", artifact_type: "PROPERTY" }, srid: 3006, distance_meters: 100 },
      result: { exists: true, match_count_observed: 1, max_features_per_layer: 50 },
    },
    property_ref: { artifact_id: "prop-reexec", artifact_type: "PROPERTY" },
    geometry: null,
    srid: 3006,
    operation: { algorithm: "spatial.dwithin_existence", engine: "PostGIS", engine_fingerprint: SPATIAL_STACK_V1 },
    layer_ref: { layer_id: layer, version_hash: versionHash, layer_version: "v1" },
    source_metadata: { provider: "SGU", dataset: layer, dataset_version: versionHash, retrieved_at: "2026-08-13T08:00:00.000Z" },
    query_context: { query_id: `q-reexec-${siteId}-${layer}`, query_type: "SPATIAL_DWITHIN", parameters: { search_distance_meters: 100 } },
  };
  const content_hash = buildSpatialEvidenceContentHash(payload as never);
  return {
    artifact_id: `spatial-reexec-${siteId}-${layer}`,
    artifact_type: "SPATIAL_EVIDENCE",
    content_hash,
    references: [{ artifact_id: "prop-reexec", artifact_type: "PROPERTY" }],
    payload,
  } as unknown as SpatialEvidenceArtifact;
}

function draft(): LocalizationAssessmentDraft {
  return {
    site_id: "site-reexec",
    project_context_ref: { artifact_id: "lu_project_context-reexec", artifact_type: "LU_PROJECT_CONTEXT" },
    property_ref: { artifact_id: "prop-reexec", artifact_type: "PROPERTY" },
    evidence_refs: [],
    system_summary: "LU-DETERMINISTIC-REEXECUTION-V1 proof",
  };
}

async function runAssessment(repo: ArtifactRepositoryPort, siteId: string, evidence: SpatialEvidenceArtifact[]) {
  for (const ev of evidence) await repo.put({ artifact_id: ev.artifact_id, content_hash: ev.content_hash, body: ev });
  return runLuAssessmentViaKernel({
    site_id: siteId,
    deterministic_seed: `seed:${siteId}`,
    evidence,
    artifact_repository: repo,
    assessment_draft: { ...draft(), site_id: siteId, evidence_refs: evidence.map((e) => ({ artifact_id: e.artifact_id, artifact_type: e.artifact_type })) },
  });
}

describe("LU-DETERMINISTIC-REEXECUTION-V1", () => {
  beforeEach(() => { process.env.MPS_LU_BOOTSTRAP_ADMIT = "1"; });
  afterEach(() => { delete process.env.MPS_LU_BOOTSTRAP_ADMIT; });

  it("15: historical supported contract version (V2, live default) -> PASS, findings/rule_refs reproduced exactly", async () => {
    const repo = new InMemoryArtifactRepository();
    const result = await runAssessment(repo, "reexec-pass", [spatialEvidence("pass", "water")]);
    expect(result.assessment).not.toBeNull();

    const reexec = await reExecuteLocalizationAssessment({ assessmentArtifactId: result.assessment!.artifact_id, artifactRepository: repo });
    expect(reexec.outcome).toBe("PASS");
    expect(reexec.mismatches).toEqual([]);
    expect(reexec.fresh_findings.map((f) => f.finding_id).sort()).toEqual(result.assessment!.payload.findings.map((f) => f.finding_id).sort());
  });

  it("14: same historical execution re-executed twice -> semantically identical result both times", async () => {
    const repo = new InMemoryArtifactRepository();
    const result = await runAssessment(repo, "reexec-twice", [spatialEvidence("twice", "ebh")]);

    const first = await reExecuteLocalizationAssessment({ assessmentArtifactId: result.assessment!.artifact_id, artifactRepository: repo });
    const second = await reExecuteLocalizationAssessment({ assessmentArtifactId: result.assessment!.artifact_id, artifactRepository: repo });
    expect(first.outcome).toBe("PASS");
    expect(second.outcome).toBe("PASS");
    expect(JSON.stringify([...first.fresh_findings].sort((a, b) => a.finding_id.localeCompare(b.finding_id)))).toBe(
      JSON.stringify([...second.fresh_findings].sort((a, b) => a.finding_id.localeCompare(b.finding_id))),
    );
  });

  it("09: one pinned evidence artifact missing from CAS -> DENY, MISSING_PINNED_EVIDENCE", async () => {
    const repo = new InMemoryArtifactRepository();
    const result = await runAssessment(repo, "reexec-missing", [spatialEvidence("missing", "water")]);

    // Simulate the exact adversarial case: the assessment still claims this evidence, but the
    // underlying CAS object is gone (e.g. a different, poorly-provisioned repository).
    const strippedRepo = new InMemoryArtifactRepository();
    await strippedRepo.put({ artifact_id: result.assessment!.artifact_id, content_hash: result.assessment!.content_hash, body: result.assessment! });
    const outcomeRef = result.assessment!.payload.execution_outcome_ref;
    const outcome = await repo.resolve(outcomeRef);
    await strippedRepo.put({ artifact_id: outcomeRef.artifact_id, content_hash: (outcome as { content_hash: { algorithm: "sha256"; value: string } }).content_hash, body: outcome });
    const attemptId = (outcome as { attempt_ref: { artifact_id: string } }).attempt_ref.artifact_id;
    const attempt = await repo.resolve({ artifact_id: attemptId, artifact_type: "execution_attempt" });
    await strippedRepo.put({ artifact_id: attemptId, content_hash: (attempt as { content_hash: { algorithm: "sha256"; value: string } }).content_hash, body: attempt });
    const manifestId = (attempt as { manifest_ref: { artifact_id: string } }).manifest_ref.artifact_id;
    const manifest = await repo.resolve({ artifact_id: manifestId, artifact_type: "execution_manifest" });
    await strippedRepo.put({ artifact_id: manifestId, content_hash: { algorithm: "sha256", value: "irrelevant" }, body: manifest });
    // Deliberately never copy the spatial evidence artifact over.

    const reexec = await reExecuteLocalizationAssessment({ assessmentArtifactId: result.assessment!.artifact_id, artifactRepository: strippedRepo });
    expect(reexec.outcome).toBe("DENY");
    expect(reexec.mismatches.some((m) => m.code === "MISSING_PINNED_EVIDENCE")).toBe(true);
  });

  it("10: one pinned evidence artifact tampered (content_hash no longer matches its own payload) -> DENY, TAMPERED_EVIDENCE", async () => {
    const repo = new InMemoryArtifactRepository();
    const result = await runAssessment(repo, "reexec-tampered", [spatialEvidence("tampered", "water")]);

    const evidenceRef = result.assessment!.payload.evidence_refs[0]!;
    const original = await repo.resolve<SpatialEvidenceArtifact>(evidenceRef);
    const tampered = { ...original, payload: { ...original.payload, result_semantics: { ...original.payload.result_semantics, result: { ...original.payload.result_semantics.result, match_count_observed: 999 } } } };
    // Overwrite the CAS entry directly -- content_hash stays the ORIGINAL (now stale) value,
    // simulating exactly the defect this check exists to catch: bytes changed, claimed hash did not.
    (repo as unknown as { store: Map<string, { content_hash: unknown; body: unknown }> }).store.set(evidenceRef.artifact_id, { content_hash: original.content_hash, body: tampered });

    const reexec = await reExecuteLocalizationAssessment({ assessmentArtifactId: result.assessment!.artifact_id, artifactRepository: repo });
    expect(reexec.outcome).toBe("DENY");
    expect(reexec.mismatches.some((m) => m.code === "TAMPERED_EVIDENCE")).toBe(true);
  });

  it("11: stored findings tampered after the fact -> FINDINGS_MISMATCH detected on re-execution", async () => {
    const repo = new InMemoryArtifactRepository();
    const result = await runAssessment(repo, "reexec-findings-tampered", [spatialEvidence("findings-tampered", "water")]);

    // Self-consistent (content_hash recomputed to match) so this test isolates the
    // findings-vs-fresh-re-execution comparison from the separate self-consistency check --
    // representative of e.g. rule-logic drift since the assessment was minted, not payload tampering.
    const tamperedAssessment = reselfHash({
      ...result.assessment!,
      payload: { ...result.assessment!.payload, findings: [{ finding_id: "finding-fabricated", rule_id: "LU-FABRICATED-001", rule_version: "1.0", risk_level: "HIGH", evidence_refs: [], explanation: "fabricated" }] },
    });
    (repo as unknown as { store: Map<string, { content_hash: unknown; body: unknown }> }).store.set(tamperedAssessment.artifact_id, { content_hash: tamperedAssessment.content_hash, body: tamperedAssessment });

    const reexec = await reExecuteLocalizationAssessment({ assessmentArtifactId: tamperedAssessment.artifact_id, artifactRepository: repo });
    expect(reexec.outcome).toBe("DENY");
    expect(reexec.mismatches.some((m) => m.code === "FINDINGS_MISMATCH")).toBe(true);
  });

  it("12: stored rule_refs tampered independently of findings -> RULE_REFS_MISMATCH detected", async () => {
    const repo = new InMemoryArtifactRepository();
    const result = await runAssessment(repo, "reexec-rule-refs-tampered", [spatialEvidence("rule-refs-tampered", "water")]);

    const tamperedAssessment = reselfHash({
      ...result.assessment!,
      payload: { ...result.assessment!.payload, rule_refs: [{ rule_id: "LU-FABRICATED-001", rule_version: "9.9" }] },
    });
    (repo as unknown as { store: Map<string, { content_hash: unknown; body: unknown }> }).store.set(tamperedAssessment.artifact_id, { content_hash: tamperedAssessment.content_hash, body: tamperedAssessment });

    const reexec = await reExecuteLocalizationAssessment({ assessmentArtifactId: tamperedAssessment.artifact_id, artifactRepository: repo });
    expect(reexec.outcome).toBe("DENY");
    expect(reexec.mismatches.some((m) => m.code === "RULE_REFS_MISMATCH")).toBe(true);
  });

  it("13: manifest and attempt from different executions -> DENY, MANIFEST_ATTEMPT_MISMATCH", async () => {
    const repo = new InMemoryArtifactRepository();
    const resultA = await runAssessment(repo, "reexec-mismatch-a", [spatialEvidence("mismatch-a", "water")]);
    const resultB = await runAssessment(repo, "reexec-mismatch-b", [spatialEvidence("mismatch-b", "ebh")]);

    // A's assessment, but its execution_outcome_ref is swapped for B's outcome, WITHOUT
    // recomputing content_hash -- the exact realistic shape of this attack: whoever tampered it
    // didn't (couldn't, without the issuer's authority) also produce a matching hash. B's own
    // outcome/attempt/manifest chain is perfectly self-consistent -- there would be no other way
    // to detect "this is the wrong execution for this assessment" except the assessment's own
    // self-consistency, which this proves catches it.
    const swapped: LocalizationAssessmentArtifact = {
      ...resultA.assessment!,
      payload: { ...resultA.assessment!.payload, execution_outcome_ref: resultB.assessment!.payload.execution_outcome_ref },
    };
    (repo as unknown as { store: Map<string, { content_hash: unknown; body: unknown }> }).store.set(swapped.artifact_id, { content_hash: resultA.assessment!.content_hash, body: swapped });

    const reexec = await reExecuteLocalizationAssessment({ assessmentArtifactId: swapped.artifact_id, artifactRepository: repo });
    expect(reexec.outcome).toBe("DENY");
    expect(reexec.mismatches.some((m) => m.code === "MANIFEST_ATTEMPT_MISMATCH")).toBe(true);
  });

  it("16: unknown/unsupported assessment_contract_version -> fail closed, UNSUPPORTED_CONTRACT_VERSION", async () => {
    const repo = new InMemoryArtifactRepository();
    const result = await runAssessment(repo, "reexec-unsupported-version", [spatialEvidence("unsupported-version", "water")]);

    const futureVersionAssessment = reselfHash({
      ...result.assessment!,
      payload: { ...result.assessment!.payload, assessment_contract_version: "localization-assessment-v99" as never },
    });
    (repo as unknown as { store: Map<string, { content_hash: unknown; body: unknown }> }).store.set(futureVersionAssessment.artifact_id, { content_hash: futureVersionAssessment.content_hash, body: futureVersionAssessment });

    const reexec = await reExecuteLocalizationAssessment({ assessmentArtifactId: futureVersionAssessment.artifact_id, artifactRepository: repo });
    expect(reexec.outcome).toBe("DENY");
    expect(reexec.mismatches).toEqual([{ code: "UNSUPPORTED_CONTRACT_VERSION", detail: expect.stringContaining("unknown assessment_contract_version") }]);
  });
});
