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

/**
 * U30-R. A content-addressed record of WHY a layer could not be checked, built independently of
 * the production factory (same RFC8785/sha256 formula, written out here) so the test is an oracle
 * for the identity contract, not a mirror of the code under test.
 */
const EBH_VERSION_HASH = "02fccffc07abaaf1775c8333d660fa60fdecea0c3bb664335892764c8486d186";
function layerUnavailableCause(layer: string, versionHash: string, reason: string) {
  const property_context_ref = { artifact_id: "prop-reexec", artifact_type: "PROPERTY" };
  const payload = {
    contract_version: "spatial-layer-unavailable-v1",
    layer_ref: { layer_id: layer, version_hash: versionHash, layer_version: "v1.0" },
    provider: "fixture-provider",
    query_contract: {
      query_contract_version: "spatial-query-contract-v3",
      spatial_canonical_version: "sv-canonical-3",
      relation: "DWITHIN",
      subject: { kind: "PROPERTY_CONTEXT_CENTROID", property_context_ref, crs: "EPSG:3006" },
      parameters: { distance_meters: 500, max_features_per_layer: 50 },
      selection: { predicate_semantics: "EXISTS" },
    },
    cause: { kind: "QUERY_EXECUTION_FAILED", reason },
  };
  const references = [property_context_ref];
  const content_hash = sha256ContentHash({ artifact_type: "SPATIAL_LAYER_UNAVAILABLE", references, payload });
  return {
    artifact_id: `layer-unavailable-${layer}-${content_hash.value.slice(0, 24)}`,
    artifact_type: "SPATIAL_LAYER_UNAVAILABLE",
    content_hash,
    references,
    payload,
  };
}

type Finding = LocalizationAssessmentArtifact["payload"]["findings"][number];
/** Same semantic-set order GovernedAssessmentPersistence enforces on V3/V4 (rule \0 version \0 id). */
function canonicalFindingOrder(findings: readonly Finding[]): Finding[] {
  const key = (f: Finding) => `${f.rule_id}\u0000${f.rule_version}\u0000${f.finding_id}`;
  return [...findings].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}
function canonicalRuleRefsFrom(findings: readonly Finding[]) {
  const key = (r: { rule_id: string; rule_version: string }) => `${r.rule_id}\u0000${r.rule_version}`;
  const unique = new Map(findings.map((f) => [key(f), { rule_id: f.rule_id, rule_version: f.rule_version }] as const));
  return [...unique.values()].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}

/** Water hit + ebh unavailable; when `pinCause` the ebh cause is pinned the way the provider does it. */
async function runWithUnavailableEbh(repo: ArtifactRepositoryPort, siteId: string, pinCause: boolean) {
  const ev = spatialEvidence(siteId, "water");
  await repo.put({ artifact_id: ev.artifact_id, content_hash: ev.content_hash, body: ev });
  const reason = "QueryFailedError: simulated";
  const cause = layerUnavailableCause("ebh", EBH_VERSION_HASH, reason);
  await repo.put({ artifact_id: cause.artifact_id, content_hash: cause.content_hash, body: cause });
  const causeRef = { artifact_id: cause.artifact_id, artifact_type: cause.artifact_type };
  const run = await runLuAssessmentViaKernel({
    site_id: siteId,
    deterministic_seed: `seed:${siteId}`,
    evidence: [ev],
    unavailable_layers: [pinCause ? { dataset: "ebh", reason, evidence_ref: causeRef } : { dataset: "ebh", reason }],
    artifact_repository: repo,
    assessment_draft: { ...draft(), site_id: siteId, evidence_refs: [{ artifact_id: ev.artifact_id, artifact_type: ev.artifact_type }] },
  } as Parameters<typeof runLuAssessmentViaKernel>[0]);
  return { run, cause, causeRef };
}

function storeTampered(repo: ArtifactRepositoryPort, tampered: LocalizationAssessmentArtifact) {
  (repo as unknown as { store: Map<string, { content_hash: unknown; body: unknown }> }).store.set(tampered.artifact_id, {
    content_hash: tampered.content_hash,
    body: tampered,
  });
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

  it("17: unavailable layer -> re-execution reproduces the identical NOT_CHECKED finding (PASS)", async () => {
    const repo = new InMemoryArtifactRepository();
    const { run, causeRef } = await runWithUnavailableEbh(repo, "reexec-nc", true);
    const stored = run.assessment!.payload.findings.find((f) => f.finding_id === "finding-notchecked-ebh");
    expect(stored?.risk_level).toBe("NOT_CHECKED"); // precondition (green before U30-R)

    const r = await reExecuteLocalizationAssessment({ assessmentArtifactId: run.assessment!.artifact_id, artifactRepository: repo });
    expect(r.mismatches).toEqual([]); // RED before U30-R: [FINDINGS_MISMATCH, RULE_REFS_MISMATCH]
    expect(r.outcome).toBe("PASS"); // RED before U30-R: DENY
    expect(r.fresh_findings.find((f) => f.finding_id === stored!.finding_id)?.explanation).toBe(stored!.explanation);

    // The cause is pinned, not merely remembered: the NOT_CHECKED finding cites it and the
    // assessment's own evidence set carries it.
    expect(stored!.evidence_refs).toEqual([causeRef]);
    expect(run.assessment!.payload.evidence_refs).toContainEqual(causeRef);
  });

  it("18: a NOT_CHECKED finding added to the stored assessment is not reproduced -> DENY, FINDINGS_MISMATCH (never derived from stored findings)", async () => {
    const repo = new InMemoryArtifactRepository();
    const { run } = await runWithUnavailableEbh(repo, "reexec-nc-forged", true);
    const forged: Finding = {
      finding_id: "finding-notchecked-protected_area",
      rule_id: "LU-PROTECTED-001",
      rule_version: "2.0",
      risk_level: "NOT_CHECKED",
      evidence_refs: [],
      explanation: 'Lagret "protected_area" kunde inte kontrolleras (QueryFailedError: forged). Ej kontrollerbart - underlag saknas.',
    } as Finding;
    const findings = canonicalFindingOrder([...run.assessment!.payload.findings, forged]);
    const tampered = reselfHash({
      ...run.assessment!,
      payload: { ...run.assessment!.payload, findings, rule_refs: canonicalRuleRefsFrom(findings) },
    });
    storeTampered(repo, tampered);

    const r = await reExecuteLocalizationAssessment({ assessmentArtifactId: tampered.artifact_id, artifactRepository: repo });
    expect(r.outcome).toBe("DENY");
    expect(r.mismatches.some((m) => m.code === "FINDINGS_MISMATCH")).toBe(true);
    expect(r.mismatches.some((m) => m.code === ("NOT_CHECKED_CAUSE_NOT_PINNED" as string))).toBe(false);
    expect(r.fresh_findings.some((f) => f.finding_id === forged.finding_id)).toBe(false);
  });

  it("18b: a forged NOT_CHECKED in an assessment that pins no cause at all still never PASSes", async () => {
    const repo = new InMemoryArtifactRepository();
    const result = await runAssessment(repo, "reexec-nc-forged-nopin", [spatialEvidence("nc-forged-nopin", "water")]);
    const forged = {
      finding_id: "finding-notchecked-ebh",
      rule_id: "LU-EBH-001",
      rule_version: "2.0",
      risk_level: "NOT_CHECKED",
      evidence_refs: [],
      explanation: 'Lagret "ebh" kunde inte kontrolleras (QueryFailedError: forged). Ej kontrollerbart - underlag saknas.',
    } as Finding;
    const findings = canonicalFindingOrder([...result.assessment!.payload.findings, forged]);
    const tampered = reselfHash({
      ...result.assessment!,
      payload: { ...result.assessment!.payload, findings, rule_refs: canonicalRuleRefsFrom(findings) },
    });
    storeTampered(repo, tampered);

    const r = await reExecuteLocalizationAssessment({ assessmentArtifactId: tampered.artifact_id, artifactRepository: repo });
    expect(r.outcome).toBe("DENY");
    expect(r.mismatches.length).toBeGreaterThan(0);
  });

  it("19: historical assessment whose NOT_CHECKED cause was never pinned -> NOT_CHECKED_CAUSE_NOT_PINNED, not FINDINGS_MISMATCH", async () => {
    const repo = new InMemoryArtifactRepository();
    // Exactly what every producer emitted before U30-R: { dataset, reason } and nothing pinned.
    const { run } = await runWithUnavailableEbh(repo, "reexec-nc-historical", false);
    const stored = run.assessment!.payload.findings.find((f) => f.finding_id === "finding-notchecked-ebh");
    expect(stored?.risk_level).toBe("NOT_CHECKED");
    expect(stored?.evidence_refs).toEqual([]);

    const r = await reExecuteLocalizationAssessment({ assessmentArtifactId: run.assessment!.artifact_id, artifactRepository: repo });
    expect(r.mismatches.map((m) => m.code)).toEqual(["NOT_CHECKED_CAUSE_NOT_PINNED"]); // RED before U30-R
    expect(r.mismatches[0]!.detail).toContain("finding-notchecked-ebh");
    expect(r.outcome).toBe("DENY"); // never PASS: the NOT_CHECKED finding cannot be re-derived
  });

  it("19b: the same historical gap on a V4-declared assessment -> NOT_CHECKED_CAUSE_NOT_PINNED", async () => {
    const repo = new InMemoryArtifactRepository();
    const { run } = await runWithUnavailableEbh(repo, "reexec-nc-historical-v4", false);
    const v4 = reselfHash({
      ...run.assessment!,
      payload: {
        ...run.assessment!.payload,
        assessment_contract_version: "localization-assessment-v4",
        canonicalizer_id: "rfc8785-sha256-v1",
        authority_evidence_ref: { artifact_id: "authority-evidence-historical", artifact_type: "authority_evidence" },
      },
    });
    storeTampered(repo, v4);

    const r = await reExecuteLocalizationAssessment({ assessmentArtifactId: v4.artifact_id, artifactRepository: repo });
    expect(r.mismatches.map((m) => m.code)).toEqual(["NOT_CHECKED_CAUSE_NOT_PINNED"]); // RED before U30-R
    expect(r.outcome).toBe("DENY");
  });

  it("20: pinned NOT_CHECKED cause tampered in CAS (reason rewritten, stale hash) -> DENY, TAMPERED_EVIDENCE", async () => {
    const repo = new InMemoryArtifactRepository();
    const { run, cause } = await runWithUnavailableEbh(repo, "reexec-nc-cause-tampered", true);
    const rewritten = { ...cause, payload: { ...cause.payload, cause: { ...cause.payload.cause, reason: "rewritten" } } };
    (repo as unknown as { store: Map<string, { content_hash: unknown; body: unknown }> }).store.set(cause.artifact_id, {
      content_hash: cause.content_hash,
      body: rewritten,
    });

    const r = await reExecuteLocalizationAssessment({ assessmentArtifactId: run.assessment!.artifact_id, artifactRepository: repo });
    expect(r.outcome).toBe("DENY");
    expect(r.mismatches.map((m) => m.code)).toEqual(["TAMPERED_EVIDENCE"]);
  });

  it("20b: pinned NOT_CHECKED cause missing from CAS -> DENY, MISSING_PINNED_EVIDENCE", async () => {
    const repo = new InMemoryArtifactRepository();
    const { run, cause } = await runWithUnavailableEbh(repo, "reexec-nc-cause-missing", true);
    (repo as unknown as { store: Map<string, unknown> }).store.delete(cause.artifact_id);

    const r = await reExecuteLocalizationAssessment({ assessmentArtifactId: run.assessment!.artifact_id, artifactRepository: repo });
    expect(r.outcome).toBe("DENY");
    expect(r.mismatches.map((m) => m.code)).toEqual(["MISSING_PINNED_EVIDENCE"]);
  });
});
