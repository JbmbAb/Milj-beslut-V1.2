import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { runCanonicalLuProductAssessment, runLuAssessmentViaKernel } from "../src/execution/LuExecutionKernelClient";
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
 * U30-R2. The provider's free failure text, of the kind `describeQueryFailure` produces from a real
 * driver error (error class + raw message, SQL included). U20CD-VERIFICATION finding 5: this must
 * never reach the stored assessment, and so never the HTTP response or the governed PDF.
 */
const RAW_PROVIDER_REASON =
  'QueryFailedError: relation "env.ebh_potentiellt_fororenade_omraden" does not exist ' +
  "(SELECT 1 AS hit FROM env.ebh_potentiellt_fororenade_omraden WHERE ST_DWithin(geom, $1, $2) LIMIT $4)";

/**
 * The standardized NOT_CHECKED explanation for NEW assessments, written out here independently of
 * the rule engine so the test is an oracle for the wording contract, not a mirror of the code.
 * Deterministic and neutral: it names the layer and the one cause class a NOT_CHECKED layer finding
 * has (the source could not be queried when the assessment ran), never the provider's own text.
 */
function standardNotCheckedExplanation(dataset: string): string {
  return `Lagret "${dataset}" kunde inte kontrolleras: källan kunde inte frågas vid bedömningen. Ej kontrollerbart - underlag saknas.`;
}

/**
 * Byte-identity goldens for assessments WITHOUT unavailable layers. Captured by running R1/R2 against
 * the code before U30-R2 (HEAD d933ddfc, mps-lu as committed in aba4305c) -- U30-R2 must not move them.
 */
const GOLDEN_R1 = {
  id: "assessment-7e34ff5afb825ba53c882611a80fb47985d21805633b7910364dbe9ae0dfe02f",
  hash: "7e34ff5afb825ba53c882611a80fb47985d21805633b7910364dbe9ae0dfe02f",
};
const GOLDEN_R2 = {
  id: "assessment-e23425323b3172bcc6e5b35bd6c71b59f8180920ec09200eedea0373ca3186da",
  hash: "e23425323b3172bcc6e5b35bd6c71b59f8180920ec09200eedea0373ca3186da",
};

/** Exactly what every producer before U30-R2 stored: the provider's free text inside the explanation. */
function legacyNotCheckedExplanation(dataset: string, reason: string): string {
  return `Lagret "${dataset}" kunde inte kontrolleras (${reason}). Ej kontrollerbart - underlag saknas.`;
}

/**
 * The record shape commit aba4305c minted (SPATIAL_LAYER_UNAVAILABLE). Built here only to prove that
 * re-execution no longer accepts it as an evidence family; nothing in the product mints it.
 */
function aba4305cShapedLayerUnavailableRecord(layer: string, reason: string) {
  const property_context_ref = { artifact_id: "prop-reexec", artifact_type: "PROPERTY" };
  const payload = {
    contract_version: "spatial-layer-unavailable-v1",
    layer_ref: { layer_id: layer, version_hash: "02fccffc07abaaf1775c8333d660fa60fdecea0c3bb664335892764c8486d186", layer_version: "v1.0" },
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

/**
 * Water hit + the given layers unavailable, reported exactly as the provider reports them under the
 * existing contract (`SpatialQueryOutcomeV2.unavailable_layers`: `{ dataset, reason }`, nothing
 * pinned, no new artifact type).
 */
async function runWithUnavailable(repo: ArtifactRepositoryPort, siteId: string, layers: readonly string[] = ["ebh"]) {
  const ev = spatialEvidence(siteId, "water");
  await repo.put({ artifact_id: ev.artifact_id, content_hash: ev.content_hash, body: ev });
  const run = await runLuAssessmentViaKernel({
    site_id: siteId,
    deterministic_seed: `seed:${siteId}`,
    evidence: [ev],
    unavailable_layers: layers.map((dataset) => ({ dataset, reason: RAW_PROVIDER_REASON })),
    artifact_repository: repo,
    assessment_draft: { ...draft(), site_id: siteId, evidence_refs: [{ artifact_id: ev.artifact_id, artifact_type: ev.artifact_type }] },
  });
  return { run, waterEvidence: ev };
}

function storeTampered(repo: ArtifactRepositoryPort, tampered: { artifact_id: string; content_hash: unknown }) {
  (repo as unknown as { store: Map<string, { content_hash: unknown; body: unknown }> }).store.set(tampered.artifact_id, {
    content_hash: tampered.content_hash,
    body: tampered,
  });
}

/** Self-consistent rewrite of the stored findings (rule_refs and content_hash recomputed), stored in place. */
function storeWithFindings(repo: ArtifactRepositoryPort, assessment: LocalizationAssessmentArtifact, findings: readonly Finding[]) {
  const ordered = canonicalFindingOrder(findings);
  const rewritten = reselfHash({
    ...assessment,
    payload: { ...assessment.payload, findings: ordered, rule_refs: canonicalRuleRefsFrom(ordered) },
  });
  storeTampered(repo, rewritten);
  return rewritten;
}

/**
 * The historical shape (before U30-R2): the same NOT_CHECKED finding, but its explanation carries the
 * provider's free text. Everything else -- id, rule, version, risk, `evidence_refs: []`, the attested
 * execution -- is exactly what the older engine produced for the same run.
 */
function storeAsHistorical(repo: ArtifactRepositoryPort, assessment: LocalizationAssessmentArtifact, explanationFor: (f: Finding) => string) {
  return storeWithFindings(
    repo,
    assessment,
    assessment.payload.findings.map((f) => (f.risk_level === "NOT_CHECKED" ? { ...f, explanation: explanationFor(f) } : f)),
  );
}

/** The attested execution lineage the kernel wrote: outcome (v2) -> CAPABILITY_EXECUTION -> capability definition. */
async function attestedLineage(repo: ArtifactRepositoryPort, assessment: LocalizationAssessmentArtifact) {
  const outcome = await repo.resolve<{ capability_execution_ref: { artifact_id: string; artifact_type: string } }>(
    assessment.payload.execution_outcome_ref,
  );
  const execution = await repo.resolve<{
    artifact_id: string;
    artifact_type: "CAPABILITY_EXECUTION";
    capability_ref: { artifact_id: string; artifact_type: string };
    input_refs: readonly unknown[];
    output_refs: readonly { artifact_id: string; artifact_type: string }[];
    content_hash: { algorithm: string; value: string };
  }>(outcome.capability_execution_ref);
  const capability = await repo.resolve<{ artifact_id: string; implementation_ref: { artifact_id: string } }>(execution.capability_ref);
  return { outcome, execution, capability };
}

const PROTECTED_NOT_CHECKED: Finding = {
  finding_id: "finding-notchecked-protected_area",
  rule_id: "LU-PROTECTED-001",
  rule_version: "2.0",
  risk_level: "NOT_CHECKED",
  evidence_refs: [],
  explanation: legacyNotCheckedExplanation("protected_area", "QueryFailedError: forged"),
} as Finding;

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

  // ---------------------------------------------------------------------------------------------
  // U30-R2: NOT_CHECKED replay within the existing contracts (owner 2026-10-02: no
  // SPATIAL_LAYER_UNAVAILABLE). Which layers were not checked is re-derived from the ATTESTED
  // execution (outcome v2 -> CAPABILITY_EXECUTION.output_refs, re-hashed), never from the stored
  // findings under comparison; the explanation is the standardized text, never the provider's.
  // ---------------------------------------------------------------------------------------------

  it("17: unavailable layer reported as { dataset, reason } -> re-execution reproduces the identical NOT_CHECKED finding (PASS, no notices)", async () => {
    const repo = new InMemoryArtifactRepository();
    const { run } = await runWithUnavailable(repo, "reexec-nc");
    const stored = run.assessment!.payload.findings.find((f) => f.finding_id === "finding-notchecked-ebh");
    expect(stored?.risk_level).toBe("NOT_CHECKED"); // precondition

    const r = await reExecuteLocalizationAssessment({ assessmentArtifactId: run.assessment!.artifact_id, artifactRepository: repo });
    expect(r.mismatches).toEqual([]);
    expect(r.outcome).toBe("PASS");
    expect(r.notices).toEqual([]);
    expect(r.fresh_findings.find((f) => f.finding_id === stored!.finding_id)).toEqual(stored);
  });

  it("17b: the stored NOT_CHECKED explanation is the standardized neutral text -- no provider/SQL text in the assessment (U20CD finding 5)", async () => {
    const repo = new InMemoryArtifactRepository();
    const { run } = await runWithUnavailable(repo, "reexec-nc-text");
    const stored = run.assessment!.payload.findings.find((f) => f.finding_id === "finding-notchecked-ebh")!;
    expect(stored.explanation).toBe(standardNotCheckedExplanation("ebh"));
    const assessmentBytes = JSON.stringify(run.assessment);
    for (const fragment of ["QueryFailedError", "does not exist", "SELECT", "ST_DWithin", "env.ebh_potentiellt_fororenade_omraden"]) {
      expect(assessmentBytes).not.toContain(fragment);
    }
  });

  it("17c: nothing new is pinned -- the assessment's evidence_refs are exactly the draft's and the NOT_CHECKED finding cites no artifact", async () => {
    const repo = new InMemoryArtifactRepository();
    const { run, waterEvidence } = await runWithUnavailable(repo, "reexec-nc-nopin");
    expect(run.assessment!.payload.evidence_refs).toEqual([{ artifact_id: waterEvidence.artifact_id, artifact_type: "SPATIAL_EVIDENCE" }]);
    expect(run.assessment!.payload.findings.find((f) => f.risk_level === "NOT_CHECKED")!.evidence_refs).toEqual([]);
  });

  it("17d: two unavailable layers next to a real hit -> both NOT_CHECKED findings reproduced (PASS)", async () => {
    const repo = new InMemoryArtifactRepository();
    const { run } = await runWithUnavailable(repo, "reexec-nc-two", ["ebh", "natura2000"]);
    expect(run.assessment!.payload.findings.filter((f) => f.risk_level === "NOT_CHECKED").map((f) => f.finding_id).sort()).toEqual([
      "finding-notchecked-ebh",
      "finding-notchecked-natura2000",
    ]);

    const r = await reExecuteLocalizationAssessment({ assessmentArtifactId: run.assessment!.artifact_id, artifactRepository: repo });
    expect(r.mismatches).toEqual([]);
    expect(r.outcome).toBe("PASS");
  });

  it("18: a NOT_CHECKED finding added to the stored assessment is not reproduced -> DENY, FINDINGS_MISMATCH (never derived from stored findings)", async () => {
    const repo = new InMemoryArtifactRepository();
    const { run } = await runWithUnavailable(repo, "reexec-nc-forged");
    const tampered = storeWithFindings(repo, run.assessment!, [...run.assessment!.payload.findings, PROTECTED_NOT_CHECKED]);

    const r = await reExecuteLocalizationAssessment({ assessmentArtifactId: tampered.artifact_id, artifactRepository: repo });
    expect(r.outcome).toBe("DENY");
    expect(r.mismatches.map((m) => m.code)).toContain("FINDINGS_MISMATCH");
    expect(r.notices).toEqual([]);
    expect(r.fresh_findings.some((f) => f.finding_id === PROTECTED_NOT_CHECKED.finding_id)).toBe(false);
  });

  it("18b: a forged NOT_CHECKED in an assessment whose execution had none -> DENY, FINDINGS_MISMATCH, never a notice", async () => {
    const repo = new InMemoryArtifactRepository();
    const result = await runAssessment(repo, "reexec-nc-forged-nopin", [spatialEvidence("nc-forged-nopin", "water")]);
    const forged = { ...PROTECTED_NOT_CHECKED, finding_id: "finding-notchecked-ebh", rule_id: "LU-EBH-001", explanation: legacyNotCheckedExplanation("ebh", "QueryFailedError: forged") } as Finding;
    const tampered = storeWithFindings(repo, result.assessment!, [...result.assessment!.payload.findings, forged]);

    const r = await reExecuteLocalizationAssessment({ assessmentArtifactId: tampered.artifact_id, artifactRepository: repo });
    expect(r.outcome).toBe("DENY");
    expect(r.mismatches.map((m) => m.code)).toContain("FINDINGS_MISMATCH");
    expect(r.notices).toEqual([]);
  });

  it("18c: a forged NOT_CHECKED written in the NEW standardized wording is still not reproduced -> DENY, FINDINGS_MISMATCH", async () => {
    const repo = new InMemoryArtifactRepository();
    const result = await runAssessment(repo, "reexec-nc-forged-std", [spatialEvidence("nc-forged-std", "water")]);
    const forged = { ...PROTECTED_NOT_CHECKED, explanation: standardNotCheckedExplanation("protected_area") } as Finding;
    const tampered = storeWithFindings(repo, result.assessment!, [...result.assessment!.payload.findings, forged]);

    const r = await reExecuteLocalizationAssessment({ assessmentArtifactId: tampered.artifact_id, artifactRepository: repo });
    expect(r.outcome).toBe("DENY");
    expect(r.mismatches.map((m) => m.code)).toContain("FINDINGS_MISMATCH");
  });

  it("18d: suppression -- a HIGH hit's evidence and finding replaced by a NOT_CHECKED for the same layer -> DENY, FINDINGS_MISMATCH", async () => {
    const repo = new InMemoryArtifactRepository();
    const water = spatialEvidence("nc-suppress", "water");
    const ebh = spatialEvidence("nc-suppress", "ebh");
    const result = await runAssessment(repo, "reexec-nc-suppress", [water, ebh]);
    expect(result.assessment!.payload.findings.some((f) => f.rule_id === "LU-EBH-001" && f.risk_level === "HIGH")).toBe(true);

    const suppressedFindings = [
      ...result.assessment!.payload.findings.filter((f) => f.rule_id !== "LU-EBH-001"),
      { ...PROTECTED_NOT_CHECKED, finding_id: "finding-notchecked-ebh", rule_id: "LU-EBH-001", explanation: standardNotCheckedExplanation("ebh") } as Finding,
    ];
    const ordered = canonicalFindingOrder(suppressedFindings);
    const tampered = reselfHash({
      ...result.assessment!,
      payload: {
        ...result.assessment!.payload,
        evidence_refs: result.assessment!.payload.evidence_refs.filter((ref) => ref.artifact_id !== ebh.artifact_id),
        findings: ordered,
        rule_refs: canonicalRuleRefsFrom(ordered),
      },
    });
    storeTampered(repo, tampered);

    const r = await reExecuteLocalizationAssessment({ assessmentArtifactId: tampered.artifact_id, artifactRepository: repo });
    expect(r.outcome).toBe("DENY");
    expect(r.mismatches.map((m) => m.code)).toContain("FINDINGS_MISMATCH");
  });

  it("18e: an honest NOT_CHECKED finding removed from the stored assessment -> DENY, FINDINGS_MISMATCH (the attested execution still names it)", async () => {
    const repo = new InMemoryArtifactRepository();
    const { run } = await runWithUnavailable(repo, "reexec-nc-removed");
    const tampered = storeWithFindings(repo, run.assessment!, run.assessment!.payload.findings.filter((f) => f.risk_level !== "NOT_CHECKED"));

    const r = await reExecuteLocalizationAssessment({ assessmentArtifactId: tampered.artifact_id, artifactRepository: repo });
    expect(r.outcome).toBe("DENY");
    expect(r.mismatches.map((m) => m.code)).toContain("FINDINGS_MISMATCH");
  });

  it("19: historical NOT_CHECKED (provider text in the explanation, evidence_refs []) -> PASS with the machine-readable notice NOT_CHECKED_CAUSE_NOT_PINNED, never a mismatch", async () => {
    const repo = new InMemoryArtifactRepository();
    const { run } = await runWithUnavailable(repo, "reexec-nc-historical");
    const historical = storeAsHistorical(repo, run.assessment!, () => legacyNotCheckedExplanation("ebh", RAW_PROVIDER_REASON));
    expect(historical.payload.findings.find((f) => f.risk_level === "NOT_CHECKED")!.evidence_refs).toEqual([]);

    const r = await reExecuteLocalizationAssessment({ assessmentArtifactId: historical.artifact_id, artifactRepository: repo });
    expect(r.mismatches).toEqual([]);
    expect(r.outcome).toBe("PASS");
    expect(r.notices).toEqual([
      { code: "NOT_CHECKED_CAUSE_NOT_PINNED", finding_ids: ["finding-notchecked-ebh"], detail: expect.stringContaining("finding-notchecked-ebh") },
    ]);
    // The finding itself is reproduced from the attested execution, in today's wording.
    expect(r.fresh_findings.find((f) => f.finding_id === "finding-notchecked-ebh")?.explanation).toBe(standardNotCheckedExplanation("ebh"));
  });

  it("19b: the same historical case on a V4-declared assessment -> PASS with NOT_CHECKED_CAUSE_NOT_PINNED", async () => {
    const repo = new InMemoryArtifactRepository();
    const { run } = await runWithUnavailable(repo, "reexec-nc-historical-v4");
    const legacyFindings = canonicalFindingOrder(
      run.assessment!.payload.findings.map((f) =>
        f.risk_level === "NOT_CHECKED" ? { ...f, explanation: legacyNotCheckedExplanation("ebh", "QueryFailedError: simulated") } : f,
      ),
    );
    const v4 = reselfHash({
      ...run.assessment!,
      payload: {
        ...run.assessment!.payload,
        findings: legacyFindings,
        rule_refs: canonicalRuleRefsFrom(legacyFindings),
        assessment_contract_version: "localization-assessment-v4",
        canonicalizer_id: "rfc8785-sha256-v1",
        authority_evidence_ref: { artifact_id: "authority-evidence-historical", artifact_type: "authority_evidence" },
      },
    });
    storeTampered(repo, v4);

    const r = await reExecuteLocalizationAssessment({ assessmentArtifactId: v4.artifact_id, artifactRepository: repo });
    expect(r.mismatches).toEqual([]);
    expect(r.outcome).toBe("PASS");
    expect(r.notices.map((n) => n.code)).toEqual(["NOT_CHECKED_CAUSE_NOT_PINNED"]);
  });

  it("19c: a NOT_CHECKED explanation that is neither today's nor the historical template -> DENY, FINDINGS_MISMATCH, no notice", async () => {
    const repo = new InMemoryArtifactRepository();
    const { run } = await runWithUnavailable(repo, "reexec-nc-rewritten");
    const rewritten = storeAsHistorical(repo, run.assessment!, () => 'Lagret "ebh" har kontrollerats utan träff.');

    const r = await reExecuteLocalizationAssessment({ assessmentArtifactId: rewritten.artifact_id, artifactRepository: repo });
    expect(r.outcome).toBe("DENY");
    expect(r.mismatches.map((m) => m.code)).toContain("FINDINGS_MISMATCH");
    expect(r.notices).toEqual([]);
  });

  it("20: the attested execution rewritten in CAS to name a forged NOT_CHECKED (hash recomputed, id kept) -> DENY, MANIFEST_ATTEMPT_MISMATCH", async () => {
    const repo = new InMemoryArtifactRepository();
    const { run } = await runWithUnavailable(repo, "reexec-nc-lineage-forged");
    const { execution, capability } = await attestedLineage(repo, run.assessment!);
    const outputs = [...execution.output_refs, { artifact_id: PROTECTED_NOT_CHECKED.finding_id, artifact_type: execution.output_refs[0]!.artifact_type }];
    const forgedExecution = {
      ...execution,
      output_refs: outputs,
      content_hash: sha256ContentHash({
        capability: capability.artifact_id,
        implementation: capability.implementation_ref.artifact_id,
        outputs: outputs.map((o) => o.artifact_id),
      }),
    };
    storeTampered(repo, forgedExecution);
    const tampered = storeWithFindings(repo, run.assessment!, [
      ...run.assessment!.payload.findings,
      { ...PROTECTED_NOT_CHECKED, explanation: standardNotCheckedExplanation("protected_area") } as Finding,
    ]);

    const r = await reExecuteLocalizationAssessment({ assessmentArtifactId: tampered.artifact_id, artifactRepository: repo });
    expect(r.outcome).toBe("DENY");
    expect(r.mismatches.map((m) => m.code)).toEqual(["MANIFEST_ATTEMPT_MISMATCH"]);
  });

  it("20b: the attested execution missing from CAS -> DENY, MANIFEST_ATTEMPT_MISMATCH (NOT_CHECKED cannot be re-derived, so nothing is claimed)", async () => {
    const repo = new InMemoryArtifactRepository();
    const { run } = await runWithUnavailable(repo, "reexec-nc-lineage-missing");
    const { execution } = await attestedLineage(repo, run.assessment!);
    (repo as unknown as { store: Map<string, unknown> }).store.delete(execution.artifact_id);

    const r = await reExecuteLocalizationAssessment({ assessmentArtifactId: run.assessment!.artifact_id, artifactRepository: repo });
    expect(r.outcome).toBe("DENY");
    expect(r.mismatches.map((m) => m.code)).toEqual(["MANIFEST_ATTEMPT_MISMATCH"]);
  });

  it("21: SPATIAL_LAYER_UNAVAILABLE (aba4305c, not adopted) is not an evidence family -> DENY, EVIDENCE_SET_MISMATCH", async () => {
    const repo = new InMemoryArtifactRepository();
    const { run } = await runWithUnavailable(repo, "reexec-nc-aba4305c");
    const record = aba4305cShapedLayerUnavailableRecord("ebh", RAW_PROVIDER_REASON);
    await repo.put({ artifact_id: record.artifact_id, content_hash: record.content_hash, body: record });
    const withRecord = reselfHash({
      ...run.assessment!,
      payload: {
        ...run.assessment!.payload,
        evidence_refs: [...run.assessment!.payload.evidence_refs, { artifact_id: record.artifact_id, artifact_type: record.artifact_type }],
      },
    });
    storeTampered(repo, withRecord);

    const r = await reExecuteLocalizationAssessment({ assessmentArtifactId: withRecord.artifact_id, artifactRepository: repo });
    expect(r.outcome).toBe("DENY");
    expect(r.mismatches.map((m) => m.code)).toEqual(["EVIDENCE_SET_MISMATCH"]);
  });

  it("R1: byte identity -- an assessment without unavailable layers is unchanged by U30-R2 (golden id and hash) and re-executes to PASS without notices", async () => {
    const repo = new InMemoryArtifactRepository();
    const result = await runAssessment(repo, "reexec-golden-1", [spatialEvidence("golden-1", "water")]);
    expect({ id: result.assessment!.artifact_id, hash: result.assessment!.content_hash.value }).toEqual(GOLDEN_R1);

    const r = await reExecuteLocalizationAssessment({ assessmentArtifactId: result.assessment!.artifact_id, artifactRepository: repo });
    expect(r.outcome).toBe("PASS");
    expect(r.mismatches).toEqual([]);
    expect(r.notices).toEqual([]);
  });

  it("R2: byte identity with two governed hits (water + ebh) -- golden id and hash unchanged", async () => {
    const repo = new InMemoryArtifactRepository();
    const result = await runAssessment(repo, "reexec-golden-2", [spatialEvidence("golden-2", "water"), spatialEvidence("golden-2", "ebh")]);
    expect({ id: result.assessment!.artifact_id, hash: result.assessment!.content_hash.value }).toEqual(GOLDEN_R2);

    const r = await reExecuteLocalizationAssessment({ assessmentArtifactId: result.assessment!.artifact_id, artifactRepository: repo });
    expect(r.outcome).toBe("PASS");
  });
});

describe("U30-R2: canonical product boundary keeps the existing NOT_CHECKED contract", () => {
  it("22: runCanonicalLuProductAssessment does not refuse an unavailable layer reported as { dataset, reason }", async () => {
    delete process.env.MPS_LU_BOOTSTRAP_ADMIT;
    const settled = await runCanonicalLuProductAssessment({
      site_id: "u30r2-canonical",
      deterministic_seed: "seed:u30r2-canonical",
      evidence: [],
      unavailable_layers: [{ dataset: "ebh", reason: "SOURCE_UNAVAILABLE" }],
      artifact_repository: new InMemoryArtifactRepository(),
      identity_subject_v3: {
        project_context_binding_ref: { artifact_id: "pcb-1", artifact_type: "PROJECT_CONTEXT_BINDING" },
        product_release_ref: { artifact_id: "release-1", artifact_type: "PRODUCT_RELEASE" },
        execution_contract_version: "lu-execution-v3",
        localization_geometry_ref: { artifact_id: "localization-geometry-u30r2", artifact_type: "localization_geometry" },
      },
    }).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    // No identity was provisioned, so admission denies -- what matters is that the boundary itself
    // does not refuse the existing machine-readable NOT_CHECKED input.
    expect("error" in settled ? (settled.error as { code?: string }).code : null).not.toBe("LU_CANONICAL_UNAVAILABLE_LAYER_CAUSE_NOT_PINNED");
    expect(settled.ok).toBe(true);
  });
});
