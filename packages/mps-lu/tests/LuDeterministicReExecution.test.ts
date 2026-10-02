import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { runCanonicalLuProductAssessment, runLuAssessmentViaKernel } from "../src/execution/LuExecutionKernelClient";
import { reExecuteLocalizationAssessment, resolveEvidence } from "../src/execution/LuDeterministicReExecution";
import type { SpatialEvidenceArtifact } from "../src/artifacts/SpatialEvidenceArtifact";
import { SPATIAL_STACK_V1 } from "../src/artifacts/SpatialEngineFingerprint";
import { buildSpatialEvidenceContentHash } from "../src/artifacts/SpatialEvidenceIdentity";
import { InMemoryArtifactRepository } from "../../mps-runtime/src/repository/InMemoryArtifactRepository";
import { sha256ContentHash, type ArtifactRepositoryPort } from "../../mps-runtime/src/kernel/ExecutionKernel";
import { CasArtifactResolver } from "../../mps-runtime/src/mimers/ArtifactResolver";
import {
  createFrozenExecutionOutcomeIdentityV2,
  type FrozenExecutionOutcomeIdentityV2,
} from "../../mps-runtime/src/contracts/freeze/FrozenIdentities";
import {
  MimersArtifactIndexReadError,
  MimersArtifactObjectMissingError,
} from "../../mps-runtime/src/repository/MimersByteStorageBackend";
import type { LocalizationAssessmentArtifact, LocalizationAssessmentDraft } from "../src/artifacts/LocalizationAssessmentArtifact";
import { __resetLuExecutionAuthorityVerifierForTests } from "../src/execution/LuExecutionAuthorityVerifier";
import { executionIdentityCanonicalBody } from "../src/execution/ExecutionIdentityAttestation";
import { isHistoricalNotCheckedExplanation } from "../src/rules/LURuleEngine";
import {
  LU_CANONICAL_AUTHORITY_ENV,
  createLuCanonicalAuthority,
  provisionLuCanonicalSubject,
  runLuCanonicalSubject,
} from "./fixtures/luCanonicalAuthorityChain";

/**
 * U30-R5 (owner principle, the K0 model; U30R4-VERIFICATION point 3): re-execution accepts a bootstrap/legacy
 * execution only in an EXPLICIT test process -- MPS_LU_BOOTSTRAP_ADMIT exactly "1" AND NODE_ENV exactly "test"
 * AND APP_ENV exactly "test" or "ci". An unset/empty APP_ENV or "development" is not a test environment, so
 * every test that verifies such an execution sets the whole test environment HERE, in the test file (never
 * as a global default in the configuration), and restores it afterwards.
 */
const EXPLICIT_TEST_BOOTSTRAP_KEYS = ["MPS_LU_BOOTSTRAP_ADMIT", "NODE_ENV", "APP_ENV"] as const;
function explicitTestBootstrapEnv() {
  const saved = new Map<string, string | undefined>();
  return {
    enter() {
      for (const key of EXPLICIT_TEST_BOOTSTRAP_KEYS) saved.set(key, process.env[key]);
      process.env.MPS_LU_BOOTSTRAP_ADMIT = "1";
      process.env.NODE_ENV = "test";
      process.env.APP_ENV = "test";
    },
    restore() {
      for (const key of EXPLICIT_TEST_BOOTSTRAP_KEYS) {
        const value = saved.get(key);
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    },
  };
}

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

// ---------------------------------------------------------------------------------------------
// U30-R3 helpers.
// ---------------------------------------------------------------------------------------------

type Ref = { readonly artifact_id: string; readonly artifact_type: string };

/**
 * A repository that raises the given storage fault for chosen reads/writes and is otherwise the
 * inner repository. `resolve`/`put` return the fault to raise, or null to pass through; `nth`
 * counts calls per artifact id so a test can fault one specific read of an id.
 */
function faultingRepository(
  inner: ArtifactRepositoryPort,
  faults: {
    readonly resolve?: (ref: Ref, nth: number) => unknown;
    readonly put?: (artifact: { artifact_id: string; body: unknown }) => unknown;
  },
): ArtifactRepositoryPort {
  const reads = new Map<string, number>();
  return {
    put: async (artifact) => {
      const fault = faults.put?.(artifact) ?? null;
      if (fault) throw fault;
      return inner.put(artifact);
    },
    resolve: async <T,>(ref: Ref): Promise<T> => {
      const nth = (reads.get(ref.artifact_id) ?? 0) + 1;
      reads.set(ref.artifact_id, nth);
      const fault = faults.resolve?.(ref, nth) ?? null;
      if (fault) throw fault;
      return inner.resolve<T>(ref as never);
    },
  };
}

/**
 * The product resolver (CasArtifactResolver) over an in-memory byte store that mirrors `inner`:
 * an id that was never stored reads as null (-> its exact "Artifact not found: <id>" signal), and
 * `corruptIds` read back as bytes that are not a JSON envelope (a corrupt CAS object).
 */
function casResolverRepository(inner: InMemoryArtifactRepository, corruptIds: ReadonlySet<string> = new Set()): ArtifactRepositoryPort {
  const store = (inner as unknown as { store: Map<string, { content_hash: unknown; body: unknown }> }).store;
  const resolver = new CasArtifactResolver({
    get: async (id: string) => {
      if (corruptIds.has(id)) return Uint8Array.from([0x7b, 0x22]);
      const hit = store.get(id);
      return hit ? new TextEncoder().encode(JSON.stringify({ artifact_id: id, content_hash: hit.content_hash, body: hit.body })) : null;
    },
  });
  return { put: (artifact) => inner.put(artifact), resolve: (ref) => resolver.resolve(ref) };
}

async function settle<T>(promise: Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  return promise.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
}

/** OD-R2 (U30-R3 K1): a storage fault is the typed technical error, carrying the stage and the original fault. */
function expectStorageFault(settled: { ok: boolean; value?: unknown; error?: unknown }, stage: string, fault: unknown) {
  expect(settled.ok, `expected a technical error, got ${JSON.stringify((settled as { value?: unknown }).value ?? null)}`).toBe(false);
  const error = (settled as { error: Error & { code?: unknown; stage?: unknown; cause?: unknown } }).error;
  expect(error.name).toBe("LuReExecutionStorageError");
  expect(error.code).toBe("LU_REEXECUTION_STORAGE_FAULT");
  expect(error.stage).toBe(stage);
  expect(error.cause).toBe(fault);
}

/**
 * U30-R5: MPS_LU_BOOTSTRAP_ADMIT present outside an explicit test process -- verify refuses to run with the typed
 * configuration error BOOTSTRAP_ADMIT_FLAG_OUTSIDE_TEST: never a PASS/DENY verdict and never excusable.
 */
function expectFlagOutsideTestRefusal(settled: { ok: boolean; value?: unknown; error?: unknown }) {
  expect(settled.ok, `expected the flag refusal, got a verdict ${JSON.stringify((settled as { value?: { outcome?: unknown } }).value?.outcome ?? null)}`).toBe(false);
  const error = (settled as { error: Error & { code?: unknown } }).error;
  expect(error.name).toBe("LuBootstrapAdmitFlagOutsideTestError");
  expect(error.code).toBe("BOOTSTRAP_ADMIT_FLAG_OUTSIDE_TEST");
}

/** A rewritten assessment stored under its own NEW content-addressed id, as a forger without WORM bypass must. */
async function storeUnderNewId(repo: ArtifactRepositoryPort, base: LocalizationAssessmentArtifact, payload: LocalizationAssessmentArtifact["payload"]) {
  const references = Array.from(
    new Map(
      [
        payload.project_context_ref,
        payload.property_ref,
        ...payload.evidence_refs,
        payload.execution_outcome_ref,
        payload.outcome_attestation_ref,
        ...(payload.localization_geometry_ref ? [payload.localization_geometry_ref] : []),
        ...(payload.authority_evidence_ref ? [payload.authority_evidence_ref] : []),
      ].map((ref) => [`${ref.artifact_type}:${ref.artifact_id}`, ref] as const),
    ).values(),
  );
  const content_hash = sha256ContentHash({ artifact_type: base.artifact_type, references, payload });
  const rewritten: LocalizationAssessmentArtifact = { ...base, artifact_id: `assessment-${content_hash.value}`, references, payload, content_hash };
  await repo.put({ artifact_id: rewritten.artifact_id, content_hash, body: rewritten });
  return rewritten;
}

function withFindings(payload: LocalizationAssessmentArtifact["payload"], findings: readonly Finding[]) {
  const ordered = canonicalFindingOrder(findings);
  return { ...payload, findings: ordered, rule_refs: canonicalRuleRefsFrom(ordered) };
}

/**
 * Exactly the provider's historical cause text (`describeQueryFailure`, SpatialProviderPostGIS.ts,
 * d27d240a .. c3d06557^, unchanged in that window; verbatim at 34097f2e = aba4305c^, lines 26-31, its
 * only call site lines 211-214), written out here as the oracle for what a genuine pre-U30-R2
 * NOT_CHECKED explanation can contain.
 */
function historicalProviderCause(error: unknown): string {
  const name = error instanceof Error ? error.name : "UnknownError";
  const message = error instanceof Error ? error.message : String(error);
  const shortMessage = message.length > 200 ? `${message.slice(0, 200)}...` : message;
  return `${name}: ${shortMessage}`;
}

describe("LU-DETERMINISTIC-REEXECUTION-V1", () => {
  const bootstrapEnv = explicitTestBootstrapEnv();
  beforeEach(() => { bootstrapEnv.enter(); });
  afterEach(() => { bootstrapEnv.restore(); });

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

  // 19b (the historical case on a V4 assessment) moved to the U30-R3 V4 block below: it now runs on a
  // real canonical V4 chain, because a V3 assessment relabelled "v4" with an authority_evidence_ref
  // that is in no CAS is exactly the unbound V4 assessment U30-R3 K2 refuses.

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

  it("20c: a CAS storage fault while reading the attested execution is a technical error (rejects), never a DENY verdict (OD-R2)", async () => {
    const repo = new InMemoryArtifactRepository();
    const { run } = await runWithUnavailable(repo, "reexec-nc-lineage-fault");
    const { execution } = await attestedLineage(repo, run.assessment!);
    const fault = new MimersArtifactObjectMissingError(execution.artifact_id, "f".repeat(64), "get");
    const faulty = faultingRepository(repo, { resolve: (ref) => (ref.artifact_id === execution.artifact_id ? fault : null) });

    const settled = await settle(reExecuteLocalizationAssessment({ assessmentArtifactId: run.assessment!.artifact_id, artifactRepository: faulty }));
    expectStorageFault(settled, "capability_execution", fault);
    expect(String((settled as { error: Error }).error.message)).toMatch(/MIMERS_ARTIFACT_OBJECT_MISSING/);
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

// =================================================================================================
// U30-R3 (verifier findings K1/F2 and K2/F1, F4-F6 in U30R2-VERIFICATION.md).
// =================================================================================================

describe("U30-R3 K1: a CAS storage fault on any read of the replay chain is a typed technical error, never a DENY (OD-R2)", () => {
  const bootstrapEnv = explicitTestBootstrapEnv();
  beforeEach(() => { bootstrapEnv.enter(); });
  afterEach(() => { bootstrapEnv.restore(); });

  const STAGES = [
    ["assessment", "LOCALIZATION_ASSESSMENT"],
    ["execution_outcome", "execution_outcome"],
    ["execution_attempt", "execution_attempt"],
    ["execution_manifest", "execution_manifest"],
    ["pinned_evidence", "SPATIAL_EVIDENCE"],
    ["capability_execution", "CAPABILITY_EXECUTION"],
    ["capability_definition", "CAPABILITY_DEFINITION"],
  ] as const;
  const FAULTS = [
    ["MimersArtifactObjectMissingError", (id: string) => new MimersArtifactObjectMissingError(id, "e".repeat(64), "get")],
    ["MimersArtifactIndexReadError", (id: string) => new MimersArtifactIndexReadError(id, `index/${id}.json`, "IO", "EIO: i/o error")],
  ] as const;

  for (const [stage, artifactType] of STAGES) {
    for (const [faultName, makeFault] of FAULTS) {
      it(`23 ${stage} / ${faultName}: rejects with LuReExecutionStorageError(stage ${stage}), the original fault as cause`, async () => {
        const repo = new InMemoryArtifactRepository();
        const { run } = await runWithUnavailable(repo, `reexec-k1-${stage}-${faultName}`);
        let fault: unknown = null;
        const faulty = faultingRepository(repo, {
          resolve: (ref) => (ref.artifact_type === artifactType ? (fault ??= makeFault(ref.artifact_id)) : null),
        });

        const settled = await settle(reExecuteLocalizationAssessment({ assessmentArtifactId: run.assessment!.artifact_id, artifactRepository: faulty }));
        expect(fault).not.toBeNull(); // precondition: the stage was really read
        expectStorageFault(settled, stage, fault);
      });
    }
  }

  it("23g: a fault on the v2-outcome locator read inside the category-A replay (swallowed there today) is a typed technical error, not a silent fallback", async () => {
    const repo = new InMemoryArtifactRepository();
    const { run } = await runWithUnavailable(repo, "reexec-k1-locator");
    const outcomeId = run.assessment!.payload.execution_outcome_ref.artifact_id;
    const fault = new MimersArtifactObjectMissingError(outcomeId, "e".repeat(64), "get");
    const faulty = faultingRepository(repo, { resolve: (ref, nth) => (ref.artifact_id === outcomeId && nth === 2 ? fault : null) });

    expectStorageFault(await settle(reExecuteLocalizationAssessment({ assessmentArtifactId: run.assessment!.artifact_id, artifactRepository: faulty })), "execution_outcome", fault);
  });

  it("23h: a storage fault writing the REPLAY record is a typed technical error, not MANIFEST_ATTEMPT_MISMATCH", async () => {
    const repo = new InMemoryArtifactRepository();
    const { run } = await runWithUnavailable(repo, "reexec-k1-replay-write");
    const fault = new MimersArtifactObjectMissingError("replay-record", "e".repeat(64), "put");
    const faulty = faultingRepository(repo, {
      put: (artifact) => ((artifact.body as { artifact_type?: string } | null)?.artifact_type === "REPLAY" ? fault : null),
    });

    expectStorageFault(await settle(reExecuteLocalizationAssessment({ assessmentArtifactId: run.assessment!.artifact_id, artifactRepository: faulty })), "replay_record", fault);
  });

  it("23i: a corrupt CAS object behind the product resolver (bytes are not a JSON envelope) is a typed technical error, not MISSING_PINNED_EVIDENCE", async () => {
    const repo = new InMemoryArtifactRepository();
    const { run } = await runWithUnavailable(repo, "reexec-k1-corrupt");
    const evidenceId = run.assessment!.payload.evidence_refs[0]!.artifact_id;

    const settled = await settle(reExecuteLocalizationAssessment({
      assessmentArtifactId: run.assessment!.artifact_id,
      artifactRepository: casResolverRepository(repo, new Set([evidenceId])),
    }));
    expect(settled.ok).toBe(false);
    const error = (settled as { error: Error & { code?: unknown; stage?: unknown; cause?: unknown } }).error;
    expect(error.name).toBe("LuReExecutionStorageError");
    expect(error.code).toBe("LU_REEXECUTION_STORAGE_FAULT");
    expect(error.stage).toBe("pinned_evidence");
    expect(error.cause).toBeInstanceOf(SyntaxError);
  });

  it("23j: resolveEvidence (exported for cold-replay proofs) rejects a storage fault as the typed technical error instead of reporting MISSING_PINNED_EVIDENCE", async () => {
    const repo = new InMemoryArtifactRepository();
    const ev = spatialEvidence("k1-resolve", "water");
    await repo.put({ artifact_id: ev.artifact_id, content_hash: ev.content_hash, body: ev });
    const fault = new MimersArtifactIndexReadError(ev.artifact_id, "index/x.json", "MALFORMED", "entry is not valid JSON");
    const faulty = faultingRepository(repo, { resolve: () => fault });

    expectStorageFault(
      await settle(resolveEvidence({ evidenceRefs: [{ artifact_id: ev.artifact_id, artifact_type: "SPATIAL_EVIDENCE" }], artifactRepository: faulty })),
      "pinned_evidence",
      fault,
    );
  });

  it("24a: the execution outcome a stored assessment pins is genuinely absent from CAS -> DENY MANIFEST_ATTEMPT_MISMATCH (an integrity/binding failure), not a thrown error", async () => {
    const repo = new InMemoryArtifactRepository();
    const { run } = await runWithUnavailable(repo, "reexec-k1-outcome-missing");
    const outcomeId = run.assessment!.payload.execution_outcome_ref.artifact_id;
    (repo as unknown as { store: Map<string, unknown> }).store.delete(outcomeId);

    const settled = await settle(reExecuteLocalizationAssessment({ assessmentArtifactId: run.assessment!.artifact_id, artifactRepository: repo }));
    expect(settled.ok).toBe(true);
    const r = (settled as { value: Awaited<ReturnType<typeof reExecuteLocalizationAssessment>> }).value;
    expect(r.outcome).toBe("DENY");
    expect(r.mismatches.map((m) => m.code)).toEqual(["MANIFEST_ATTEMPT_MISMATCH"]);
    expect(r.mismatches[0]!.detail).toContain(outcomeId);
  });

  it("24b: through the product resolver, an honest assessment still PASSes, and a pinned evidence that was never stored is DENY MISSING_PINNED_EVIDENCE", async () => {
    const repo = new InMemoryArtifactRepository();
    const { run, waterEvidence } = await runWithUnavailable(repo, "reexec-k1-resolver");
    const viaResolver = casResolverRepository(repo);
    expect((await reExecuteLocalizationAssessment({ assessmentArtifactId: run.assessment!.artifact_id, artifactRepository: viaResolver })).outcome).toBe("PASS");

    (repo as unknown as { store: Map<string, unknown> }).store.delete(waterEvidence.artifact_id);
    const r = await reExecuteLocalizationAssessment({ assessmentArtifactId: run.assessment!.artifact_id, artifactRepository: viaResolver });
    expect(r.outcome).toBe("DENY");
    expect(r.mismatches.map((m) => m.code)).toEqual(["MISSING_PINNED_EVIDENCE"]);
  });

  it("24c: an assessment id that was never stored rejects with the repository's own not-found signal -- distinct from a storage fault", async () => {
    const settled = await settle(reExecuteLocalizationAssessment({ assessmentArtifactId: "assessment-never-stored", artifactRepository: new InMemoryArtifactRepository() }));
    expect(settled.ok).toBe(false);
    const error = (settled as { error: Error }).error;
    expect(error.message).toBe("Artifact not found: assessment-never-stored");
    expect(error.name).not.toBe("LuReExecutionStorageError");
  });
});

describe("U30-R3 K2: the attested execution's output_refs bind EXACTLY to the findings re-executed from the assessment's pinned evidence", () => {
  const bootstrapEnv = explicitTestBootstrapEnv();
  beforeEach(() => { bootstrapEnv.enter(); });
  afterEach(() => { bootstrapEnv.restore(); });

  it("25a (verifier X3, the K2 attack): HIGH suppressed by pointing the assessment at ANOTHER assessment's outcome where the layer was unavailable -> DENY MANIFEST_ATTEMPT_MISMATCH", async () => {
    const repo = new InMemoryArtifactRepository();
    const water = spatialEvidence("k2-a", "water");
    const ebh = spatialEvidence("k2-a", "ebh");
    const a = (await runAssessment(repo, "reexec-k2-a", [water, ebh])).assessment!;
    const b = (await runWithUnavailable(repo, "reexec-k2-b")).run.assessment!;
    expect(a.payload.findings.some((f) => f.rule_id === "LU-EBH-001" && f.risk_level === "HIGH")).toBe(true); // precondition
    expect((await reExecuteLocalizationAssessment({ assessmentArtifactId: a.artifact_id, artifactRepository: repo })).outcome).toBe("PASS");
    expect((await reExecuteLocalizationAssessment({ assessmentArtifactId: b.artifact_id, artifactRepository: repo })).outcome).toBe("PASS");

    const notCheckedEbh = b.payload.findings.find((f) => f.finding_id === "finding-notchecked-ebh")!;
    const forged = await storeUnderNewId(repo, a, withFindings(
      {
        ...a.payload,
        execution_outcome_ref: b.payload.execution_outcome_ref,
        outcome_attestation_ref: b.payload.outcome_attestation_ref,
        evidence_refs: a.payload.evidence_refs.filter((ref) => ref.artifact_id !== ebh.artifact_id),
      },
      [...a.payload.findings.filter((f) => f.rule_id !== "LU-EBH-001"), notCheckedEbh],
    ));

    const r = await reExecuteLocalizationAssessment({ assessmentArtifactId: forged.artifact_id, artifactRepository: repo });
    expect(r.outcome).toBe("DENY");
    expect(r.mismatches.map((m) => m.code)).toContain("MANIFEST_ATTEMPT_MISMATCH");
    expect(r.notices).toEqual([]);
  });

  it("25c (F6): a HIGH evidence and its finding removed from a rewritten assessment (new id, same outcome) -> DENY MANIFEST_ATTEMPT_MISMATCH", async () => {
    const repo = new InMemoryArtifactRepository();
    const water = spatialEvidence("k2-remove", "water");
    const ebh = spatialEvidence("k2-remove", "ebh");
    const a = (await runAssessment(repo, "reexec-k2-remove", [water, ebh])).assessment!;
    const forged = await storeUnderNewId(repo, a, withFindings(
      { ...a.payload, evidence_refs: a.payload.evidence_refs.filter((ref) => ref.artifact_id !== ebh.artifact_id) },
      a.payload.findings.filter((f) => f.rule_id !== "LU-EBH-001"),
    ));

    const r = await reExecuteLocalizationAssessment({ assessmentArtifactId: forged.artifact_id, artifactRepository: repo });
    expect(r.outcome).toBe("DENY");
    expect(r.mismatches.map((m) => m.code)).toEqual(["MANIFEST_ATTEMPT_MISMATCH"]);
  });

  it("25d (F6): a fabricated, self-consistent HIGH evidence and finding added to a rewritten assessment -> DENY MANIFEST_ATTEMPT_MISMATCH", async () => {
    const repo = new InMemoryArtifactRepository();
    const a = (await runAssessment(repo, "reexec-k2-add", [spatialEvidence("k2-add", "water")])).assessment!;
    const fabricated = spatialEvidence("k2-add-fabricated", "ebh");
    await repo.put({ artifact_id: fabricated.artifact_id, content_hash: fabricated.content_hash, body: fabricated });
    const fabricatedFinding = {
      finding_id: `finding-ebh-${fabricated.artifact_id}`,
      rule_id: "LU-EBH-001",
      rule_version: "2.0",
      risk_level: "HIGH",
      evidence_refs: [{ artifact_id: fabricated.artifact_id, artifact_type: "SPATIAL_EVIDENCE" }],
      explanation: "Potentiellt förorenat område inom sökradie",
    } as Finding;
    const forged = await storeUnderNewId(repo, a, withFindings(
      {
        ...a.payload,
        evidence_refs: [...a.payload.evidence_refs, { artifact_id: fabricated.artifact_id, artifact_type: "SPATIAL_EVIDENCE" }].sort((x, y) =>
          `${x.artifact_type}:${x.artifact_id}` < `${y.artifact_type}:${y.artifact_id}` ? -1 : 1,
        ),
      },
      [...a.payload.findings, fabricatedFinding],
    ));

    const r = await reExecuteLocalizationAssessment({ assessmentArtifactId: forged.artifact_id, artifactRepository: repo });
    expect(r.outcome).toBe("DENY");
    expect(r.mismatches.map((m) => m.code)).toEqual(["MANIFEST_ATTEMPT_MISMATCH"]);
  });

  it("25e (F5): an execution record with an extra junk output (outcome re-pointed in place, i.e. WORM bypass) -> DENY: no output beyond the re-executed findings is accepted", async () => {
    const repo = new InMemoryArtifactRepository();
    const { run } = await runWithUnavailable(repo, "reexec-k2-junk");
    const { execution, capability } = await attestedLineage(repo, run.assessment!);
    const outputs = [...execution.output_refs, { artifact_id: "finding-junk-nonce-0001", artifact_type: execution.output_refs[0]!.artifact_type }];
    const hash = sha256ContentHash({
      capability: capability.artifact_id,
      implementation: capability.implementation_ref.artifact_id,
      outputs: outputs.map((o) => o.artifact_id),
    });
    const junkExecution = { ...execution, artifact_id: `exec-${capability.artifact_id}-${hash.value.slice(0, 12)}`, output_refs: outputs, content_hash: hash };
    await repo.put({ artifact_id: junkExecution.artifact_id, content_hash: hash, body: junkExecution });
    const original = await repo.resolve<FrozenExecutionOutcomeIdentityV2>(run.assessment!.payload.execution_outcome_ref);
    const repointed = createFrozenExecutionOutcomeIdentityV2({
      attempt_ref: original.attempt_ref,
      result: original.result,
      capability_execution_ref: { artifact_id: junkExecution.artifact_id, artifact_type: "CAPABILITY_EXECUTION" },
    });
    (repo as unknown as { store: Map<string, { content_hash: unknown; body: unknown }> }).store.set(repointed.outcome_id, { content_hash: repointed.content_hash, body: repointed });

    const r = await reExecuteLocalizationAssessment({ assessmentArtifactId: run.assessment!.artifact_id, artifactRepository: repo });
    expect(r.outcome).toBe("DENY");
    expect(r.mismatches.map((m) => m.code)).toEqual(["MANIFEST_ATTEMPT_MISMATCH"]);
    expect(r.mismatches[0]!.detail).toContain("finding-junk-nonce-0001");
  });
});

describe("U30-R3 K2 on the canonical V4 chain: the assessment's authority subject must name the execution its outcome pins", () => {
  const saved = new Map<string, string | undefined>();
  beforeEach(() => { for (const name of LU_CANONICAL_AUTHORITY_ENV) saved.set(name, process.env[name]); });
  afterEach(() => {
    for (const name of LU_CANONICAL_AUTHORITY_ENV) {
      const value = saved.get(name);
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    __resetLuExecutionAuthorityVerifierForTests(null);
  });

  /** A: one ebh HIGH and nothing else. B: no hit at all, ebh unavailable. Both genuine canonical V4 runs. */
  async function twoCanonicalSubjects() {
    const repo = new InMemoryArtifactRepository();
    const authority = await createLuCanonicalAuthority(repo);
    const subjectA = await provisionLuCanonicalSubject(authority, "u30r3-a");
    const subjectB = await provisionLuCanonicalSubject(authority, "u30r3-b");
    const ebhA = spatialEvidence("u30r3-a", "ebh");
    const runA = await runLuCanonicalSubject(authority, subjectA, { evidence: [ebhA] });
    const runB = await runLuCanonicalSubject(authority, subjectB, { evidence: [], unavailable_layers: [{ dataset: "ebh", reason: "SOURCE_UNAVAILABLE" }] });
    expect(runA.assessment?.payload.assessment_contract_version).toBe("localization-assessment-v4"); // precondition
    expect(runB.assessment?.payload.assessment_contract_version).toBe("localization-assessment-v4");
    return { repo, subjectA, subjectB, A: runA.assessment!, B: runB.assessment! };
  }

  /** B's outcome and attestation under A's subject, with exactly the findings B's execution produced. */
  function redirectedToB(A: LocalizationAssessmentArtifact, B: LocalizationAssessmentArtifact, overrides: Partial<LocalizationAssessmentArtifact["payload"]> = {}) {
    return withFindings(
      {
        ...A.payload,
        execution_outcome_ref: B.payload.execution_outcome_ref,
        outcome_attestation_ref: B.payload.outcome_attestation_ref,
        evidence_refs: [],
        ...overrides,
      },
      B.payload.findings,
    );
  }

  it("25h: genuine V4 assessments (a hit; a NOT_CHECKED layer) re-execute to PASS -- the binding refuses nothing honest", async () => {
    const { repo, A, B } = await twoCanonicalSubjects();
    for (const assessment of [A, B]) {
      const r = await reExecuteLocalizationAssessment({ assessmentArtifactId: assessment.artifact_id, artifactRepository: repo });
      expect(r.mismatches).toEqual([]);
      expect(r.outcome).toBe("PASS");
    }
  });

  it("25f (K2, the no-hit variant exact output binding alone cannot see): A's HIGH suppressed by pointing A at B's outcome, A's own authority evidence kept -> DENY MANIFEST_ATTEMPT_MISMATCH", async () => {
    const { repo, A, B } = await twoCanonicalSubjects();
    const forged = await storeUnderNewId(repo, A, redirectedToB(A, B));
    expect(forged.payload.findings.map((f) => f.finding_id)).toEqual(["finding-notchecked-ebh"]); // B's execution produced exactly this

    const r = await reExecuteLocalizationAssessment({ assessmentArtifactId: forged.artifact_id, artifactRepository: repo });
    expect(r.outcome).toBe("DENY");
    expect(r.mismatches.map((m) => m.code)).toEqual(["MANIFEST_ATTEMPT_MISMATCH"]);
  });

  it("25g: the same redirect with B's authority evidence too (A's localization point kept) -> DENY MANIFEST_ATTEMPT_MISMATCH", async () => {
    const { repo, A, B } = await twoCanonicalSubjects();
    const forged = await storeUnderNewId(repo, A, redirectedToB(A, B, { authority_evidence_ref: B.payload.authority_evidence_ref }));

    const r = await reExecuteLocalizationAssessment({ assessmentArtifactId: forged.artifact_id, artifactRepository: repo });
    expect(r.outcome).toBe("DENY");
    expect(r.mismatches.map((m) => m.code)).toEqual(["MANIFEST_ATTEMPT_MISMATCH"]);
  });

  it("25i: the authority evidence a V4 assessment pins is not in CAS -> DENY MANIFEST_ATTEMPT_MISMATCH (an unbound V4 assessment)", async () => {
    const { repo, A } = await twoCanonicalSubjects();
    (repo as unknown as { store: Map<string, unknown> }).store.delete(A.payload.authority_evidence_ref!.artifact_id);

    const r = await reExecuteLocalizationAssessment({ assessmentArtifactId: A.artifact_id, artifactRepository: repo });
    expect(r.outcome).toBe("DENY");
    expect(r.mismatches.map((m) => m.code)).toEqual(["MANIFEST_ATTEMPT_MISMATCH"]);
  });

  it("25j: A's authority evidence rewritten in place to name B's identity (hash recomputed, id kept: WORM bypass) and A pointed at B's outcome -> DENY", async () => {
    const { repo, A, B } = await twoCanonicalSubjects();
    const evidenceA = await repo.resolve<Record<string, unknown> & { authority_path: { role: string }[] }>(A.payload.authority_evidence_ref!);
    const evidenceB = await repo.resolve<{ authority_path: { role: string }[] }>(B.payload.authority_evidence_ref!);
    const { content_hash: _ignored, ...bodyA } = evidenceA;
    const rewrittenBody = {
      ...bodyA,
      authority_path: evidenceA.authority_path.map((entry) => (entry.role === "subject" ? evidenceB.authority_path.find((e) => e.role === "subject")! : entry)),
    };
    (repo as unknown as { store: Map<string, { content_hash: unknown; body: unknown }> }).store.set(A.payload.authority_evidence_ref!.artifact_id, {
      content_hash: sha256ContentHash(rewrittenBody),
      body: { ...rewrittenBody, content_hash: sha256ContentHash(rewrittenBody) },
    });
    const forged = await storeUnderNewId(repo, A, redirectedToB(A, B));

    const r = await reExecuteLocalizationAssessment({ assessmentArtifactId: forged.artifact_id, artifactRepository: repo });
    expect(r.outcome).toBe("DENY");
    expect(r.mismatches.map((m) => m.code)).toEqual(["MANIFEST_ATTEMPT_MISMATCH"]);
  });

  it("25o: the same in-place rewrite with B's localization point too -- only the evidence id, re-derived from its content, still tells -> DENY", async () => {
    const { repo, A, B } = await twoCanonicalSubjects();
    const evidenceA = await repo.resolve<Record<string, unknown> & { authority_path: { role: string }[] }>(A.payload.authority_evidence_ref!);
    const evidenceB = await repo.resolve<{ authority_path: { role: string }[] }>(B.payload.authority_evidence_ref!);
    const { content_hash: _ignored, ...bodyA } = evidenceA;
    const rewrittenBody = {
      ...bodyA,
      authority_path: evidenceA.authority_path.map((entry) => (entry.role === "subject" ? evidenceB.authority_path.find((e) => e.role === "subject")! : entry)),
    };
    (repo as unknown as { store: Map<string, { content_hash: unknown; body: unknown }> }).store.set(A.payload.authority_evidence_ref!.artifact_id, {
      content_hash: sha256ContentHash(rewrittenBody),
      body: { ...rewrittenBody, content_hash: sha256ContentHash(rewrittenBody) },
    });
    const forged = await storeUnderNewId(repo, A, redirectedToB(A, B, { localization_geometry_ref: B.payload.localization_geometry_ref }));

    const r = await reExecuteLocalizationAssessment({ assessmentArtifactId: forged.artifact_id, artifactRepository: repo });
    expect(r.outcome).toBe("DENY");
    expect(r.mismatches.map((m) => m.code)).toEqual(["MANIFEST_ATTEMPT_MISMATCH"]);
    expect(r.mismatches[0]!.detail).toContain("does not match its own content");
  });

  for (const [stage, pick] of [
    ["authority_evidence", (A: LocalizationAssessmentArtifact, _identityId: string) => A.payload.authority_evidence_ref!.artifact_id],
    ["execution_identity", (_A: LocalizationAssessmentArtifact, identityId: string) => identityId],
  ] as const) {
    it(`25k ${stage}: a storage fault reading the ${stage} is the typed technical error (OD-R2)`, async () => {
      const { repo, subjectA, A } = await twoCanonicalSubjects();
      const targetId = pick(A, subjectA.identity.artifact_id);
      const fault = new MimersArtifactObjectMissingError(targetId, "e".repeat(64), "get");
      const faulty = faultingRepository(repo, { resolve: (ref) => (ref.artifact_id === targetId ? fault : null) });

      expectStorageFault(await settle(reExecuteLocalizationAssessment({ assessmentArtifactId: A.artifact_id, artifactRepository: faulty })), stage, fault);
    });
  }

  /** A new, self-consistent AuthorityEvidence (id derived from its canonical fields) built from `base`. */
  async function storeForgedAuthorityEvidence(
    repo: ArtifactRepositoryPort,
    base: Record<string, unknown>,
    change: (canonical: Record<string, unknown>) => Record<string, unknown>,
  ) {
    const { artifact_id: _id, references, content_hash: _hash, ...canonical } = base;
    const forgedCanonical = change(canonical);
    const artifact_id = `authority-evidence-${sha256ContentHash(forgedCanonical).value.slice(0, 24)}`;
    const body = { artifact_id, references, ...forgedCanonical };
    const content_hash = sha256ContentHash(body);
    await repo.put({ artifact_id, content_hash, body: { ...body, content_hash } });
    return { artifact_id, artifact_type: "authority_evidence" as const };
  }

  type PathEntry = { role: string; artifact_ref?: unknown; content_hash?: unknown };

  it("25l: the execution identity the authority evidence names, rewritten in place (same id and subject, another actor; WORM bypass) -> DENY", async () => {
    const { repo, subjectA, A } = await twoCanonicalSubjects();
    const rewritten = { ...subjectA.identity, actor_ref: { artifact_id: "another-actor", artifact_type: "execution_identity" } };
    const hash = sha256ContentHash(executionIdentityCanonicalBody(rewritten));
    (repo as unknown as { store: Map<string, { content_hash: unknown; body: unknown }> }).store.set(subjectA.identity.artifact_id, {
      content_hash: hash,
      body: { ...rewritten, content_hash: hash },
    });

    const r = await reExecuteLocalizationAssessment({ assessmentArtifactId: A.artifact_id, artifactRepository: repo });
    expect(r.outcome).toBe("DENY");
    expect(r.mismatches.map((m) => m.code)).toEqual(["MANIFEST_ATTEMPT_MISMATCH"]);
  });

  for (const [label, rewriteSubject] of [
    ["names no subject at all", (path: PathEntry[]) => path.filter((entry) => entry.role !== "subject")],
    ["names a subject without a reference", (path: PathEntry[]) => path.map((entry) => (entry.role === "subject" ? { role: "subject", content_hash: entry.content_hash } : entry))],
  ] as const) {
    it(`25m: a V4 assessment pinned to a new, self-consistent authority evidence that ${label} -> DENY`, async () => {
      const { repo, A } = await twoCanonicalSubjects();
      const evidenceA = await repo.resolve<Record<string, unknown>>(A.payload.authority_evidence_ref!);
      const forgedRef = await storeForgedAuthorityEvidence(repo, evidenceA, (canonical) => ({
        ...canonical,
        authority_path: rewriteSubject(canonical.authority_path as PathEntry[]),
      }));
      const forged = await storeUnderNewId(repo, A, { ...A.payload, authority_evidence_ref: forgedRef });

      const r = await reExecuteLocalizationAssessment({ assessmentArtifactId: forged.artifact_id, artifactRepository: repo });
      expect(r.outcome).toBe("DENY");
      expect(r.mismatches.map((m) => m.code)).toEqual(["MANIFEST_ATTEMPT_MISMATCH"]);
    });
  }

  it("25n: a V4 assessment whose authority evidence names a hashed identity WITHOUT a V3 subject -> DENY, never a crash", async () => {
    const { repo, subjectA, A } = await twoCanonicalSubjects();
    const { subject_v3: _subject, execution_identity_contract_version: _version, ...withoutSubject } = subjectA.identity;
    const forgedIdentity = { ...withoutSubject, artifact_id: "lu-identity-u30r3-without-subject" };
    const identityHash = sha256ContentHash(executionIdentityCanonicalBody(forgedIdentity as never));
    await repo.put({ artifact_id: forgedIdentity.artifact_id, content_hash: identityHash, body: { ...forgedIdentity, content_hash: identityHash } });
    const evidenceA = await repo.resolve<Record<string, unknown>>(A.payload.authority_evidence_ref!);
    const forgedRef = await storeForgedAuthorityEvidence(repo, evidenceA, (canonical) => ({
      ...canonical,
      authority_path: (canonical.authority_path as PathEntry[]).map((entry) =>
        entry.role === "subject"
          ? { role: "subject", artifact_ref: { artifact_id: forgedIdentity.artifact_id, artifact_type: "execution_identity" }, content_hash: identityHash }
          : entry,
      ),
    }));
    const forged = await storeUnderNewId(repo, A, { ...A.payload, authority_evidence_ref: forgedRef });

    const r = await reExecuteLocalizationAssessment({ assessmentArtifactId: forged.artifact_id, artifactRepository: repo });
    expect(r.outcome).toBe("DENY");
    expect(r.mismatches.map((m) => m.code)).toEqual(["MANIFEST_ATTEMPT_MISMATCH"]);
  });

  it("19b: historical NOT_CHECKED wording on a genuine V4 assessment -> PASS with NOT_CHECKED_CAUSE_NOT_PINNED", async () => {
    const { repo, B } = await twoCanonicalSubjects();
    const cause = historicalProviderCause(Object.assign(new Error('relation "env.ebh" does not exist'), { name: "error" }));
    const historical = storeAsHistorical(repo, B, () => legacyNotCheckedExplanation("ebh", cause));

    const r = await reExecuteLocalizationAssessment({ assessmentArtifactId: historical.artifact_id, artifactRepository: repo });
    expect(r.mismatches).toEqual([]);
    expect(r.outcome).toBe("PASS");
    expect(r.notices.map((n) => n.code)).toEqual(["NOT_CHECKED_CAUSE_NOT_PINNED"]);
  });
});

describe("U30-R3 (a): a historical NOT_CHECKED explanation is recognized only in the exact form the provider produced", () => {
  const bootstrapEnv = explicitTestBootstrapEnv();
  beforeEach(() => { bootstrapEnv.enter(); });
  afterEach(() => { bootstrapEnv.restore(); });

  const GENUINE: ReadonlyArray<readonly [string, unknown]> = [
    ["pg DatabaseError (name 'error')", Object.assign(new Error('relation "env.ebh_potentiellt_fororenade_omraden" does not exist'), { name: "error" })],
    ["connection refused", new Error("connect ECONNREFUSED 127.0.0.1:5432")],
    ["AggregateError with an empty message", new AggregateError([], "")],
    ["TypeError", new TypeError("Cannot read properties of undefined (reading 'rowCount')")],
    ["a message over 200 characters (truncated + '...')", new Error(`canceling statement due to statement timeout ${"x".repeat(240)}`)],
    ["a non-Error throw", "Query read timeout"],
    // U30-R3 verification F3: the producer never removed line breaks, tabs or odd names.
    ["a multi-line pg message", Object.assign(new Error('syntax error at or near "FROM"\nLINE 1: SELECT 1 AS hit FROM\n                        ^'), { name: "error" })],
    ["a message with tabs and a carriage return", new Error("connection terminated\tunexpectedly\r\nretry later")],
    ["an empty error name", Object.assign(new Error("boom"), { name: "" })],
    ["an error name with spaces", Object.assign(new Error("relation does not exist"), { name: "Database Error" })],
    ["an error name containing ': '", Object.assign(new Error("x"), { name: "pg: error" })],
    ["a multi-line message over 200 characters, truncated", new Error(`first line\n${"y".repeat(250)}`)],
    ["a non-Error throw with a line break", "line one\nline two"],
    ["a message of exactly 200 units (not truncated)", new Error("m".repeat(200))],
    // The separator is not necessarily the first nor the last ": " of the cause.
    ["an error name containing ': ' with a truncated message", Object.assign(new Error("q".repeat(260)), { name: "pg: error" })],
    ["a truncated message that itself starts with ': '", new Error(`: ${"z".repeat(260)}`)],
  ];
  for (const [label, thrown] of GENUINE) {
    it(`19g genuine (${label}) -> PASS + NOT_CHECKED_CAUSE_NOT_PINNED`, async () => {
      const repo = new InMemoryArtifactRepository();
      const { run } = await runWithUnavailable(repo, `reexec-a-genuine-${label.length}`);
      const historical = storeAsHistorical(repo, run.assessment!, () => legacyNotCheckedExplanation("ebh", historicalProviderCause(thrown)));

      const r = await reExecuteLocalizationAssessment({ assessmentArtifactId: historical.artifact_id, artifactRepository: repo });
      expect(r.mismatches).toEqual([]);
      expect(r.outcome).toBe("PASS");
      expect(r.notices.map((n) => n.code)).toEqual(["NOT_CHECKED_CAUSE_NOT_PINNED"]);
    });
  }

  it("19h: a seeded sweep of producer outputs (any name, any message incl. line breaks, tabs, ': ', lone surrogates, lengths around the limit) is recognized; generated non-producible text is not", () => {
    let seed = 0x5eed2003;
    const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
    const ALPHABET = ["a", "Ö", " ", ":", ": ", "\n", "\t", "\r", ".", "...", "\"", "(", ")", "\ud800", "é"];
    const randomText = (max: number) => {
      const length = next() % (max + 1);
      let text = "";
      while (text.length < length) text += ALPHABET[next() % ALPHABET.length];
      return text.slice(0, length);
    };
    const historical = (cause: string) => legacyNotCheckedExplanation("ebh", cause);
    for (let i = 0; i < 2000; i += 1) {
      const name = randomText(12);
      const message = randomText(i % 2 === 0 ? 40 : 260);
      const thrown = i % 7 === 0 ? message : Object.assign(new Error(message), { name });
      const cause = historicalProviderCause(thrown);
      expect(isHistoricalNotCheckedExplanation(historical(cause), "ebh"), JSON.stringify(cause)).toBe(true);
    }
    const NO_SEPARATOR = ["a", "Ö", " ", ":", "\n", "\t", ".", "("];
    for (let i = 0; i < 500; i += 1) {
      let text = "";
      const length = next() % 300;
      while (text.length < length) text += NO_SEPARATOR[next() % NO_SEPARATOR.length];
      let withoutSeparator = text;
      while (withoutSeparator.includes(": ")) withoutSeparator = withoutSeparator.split(": ").join(":");
      expect(isHistoricalNotCheckedExplanation(historical(withoutSeparator), "ebh"), JSON.stringify(withoutSeparator)).toBe(false);
      const tail = "x".repeat(201 + (next() % 2)) + (i % 2 === 0 ? "" : "y".repeat(next() % 50));
      expect(isHistoricalNotCheckedExplanation(historical(`${withoutSeparator}: ${tail}`), "ebh")).toBe(false);
    }
  });

  // Text the producer could never return: no ": " at all, or no ": " followed by a tail its
  // truncation could produce (at most 200 UTF-16 units, or exactly 200 followed by "...").
  const NOT_THE_PRODUCER: ReadonlyArray<readonly [string, string]> = [
    ["free text without ': ' (verifier X7)", "men inga förorenade områden finns inom 500 m"],
    ["an over-long message that was never truncated", `Error: ${"a".repeat(201)}`],
    ["a truncation marker on a message of the wrong length", `Error: ${"a".repeat(201)}...`],
    ["a 203-unit message without the truncation marker", `Error: ${"a".repeat(203)}`],
    ["a 202-unit message ending in the truncation marker", `Error: ${"a".repeat(199)}...`],
    ["no separator after the name", "QueryFailedError"],
    ["a colon without the following space", "Error:inga träffar"],
  ];
  for (const [label, cause] of NOT_THE_PRODUCER) {
    it(`19d not the producer's form (${label}) -> DENY FINDINGS_MISMATCH, no notice`, async () => {
      const repo = new InMemoryArtifactRepository();
      const { run } = await runWithUnavailable(repo, `reexec-a-forged-${label.length}`);
      const rewritten = storeAsHistorical(repo, run.assessment!, () => legacyNotCheckedExplanation("ebh", cause));

      const r = await reExecuteLocalizationAssessment({ assessmentArtifactId: rewritten.artifact_id, artifactRepository: repo });
      expect(r.outcome).toBe("DENY");
      expect(r.mismatches.map((m) => m.code)).toContain("FINDINGS_MISMATCH");
      expect(r.notices).toEqual([]);
    });
  }
});

describe("U30-R3 (owner 2026-10-02): a provider diagnostic never reaches an artifact, the kernel result or the replay identity", () => {
  const bootstrapEnv = explicitTestBootstrapEnv();
  beforeEach(() => { bootstrapEnv.enter(); });
  afterEach(() => { bootstrapEnv.restore(); });

  const DIAGNOSTIC =
    'error: relation "env.ebh_diag_u30r3" does not exist (SELECT 1 AS hit FROM env.ebh_diag_u30r3 WHERE ST_DWithin(geom, $1, $2) LIMIT $4) at 10.9.8.7:5432';

  async function runWithDiagnostic(diagnostic: string | undefined) {
    const repo = new InMemoryArtifactRepository();
    const ev = spatialEvidence("diag-u30r3", "water");
    await repo.put({ artifact_id: ev.artifact_id, content_hash: ev.content_hash, body: ev });
    const run = await runLuAssessmentViaKernel({
      site_id: "reexec-diag-u30r3",
      deterministic_seed: "seed:reexec-diag-u30r3",
      evidence: [ev],
      unavailable_layers: [{ dataset: "ebh", reason: "SOURCE_UNAVAILABLE", ...(diagnostic === undefined ? {} : { diagnostic }) }],
      artifact_repository: repo,
      assessment_draft: { ...draft(), site_id: "reexec-diag-u30r3", evidence_refs: [{ artifact_id: ev.artifact_id, artifact_type: ev.artifact_type }] },
    });
    return { repo, run };
  }

  it("26: with and without a diagnostic the assessment is byte-identical; no CAS object, kernel result or re-execution result carries any part of it", async () => {
    const withDiag = await runWithDiagnostic(DIAGNOSTIC);
    const without = await runWithDiagnostic(undefined);
    expect(withDiag.run.assessment!.artifact_id).toBe(without.run.assessment!.artifact_id);
    expect(withDiag.run.assessment!.content_hash).toEqual(without.run.assessment!.content_hash);

    const r = await reExecuteLocalizationAssessment({ assessmentArtifactId: withDiag.run.assessment!.artifact_id, artifactRepository: withDiag.repo });
    expect(r.outcome).toBe("PASS");

    const stored = JSON.stringify([...(withDiag.repo as unknown as { store: Map<string, unknown> }).store.entries()]);
    const kernelResult = JSON.stringify(withDiag.run);
    for (const surface of [stored, kernelResult, JSON.stringify(r)]) {
      for (const fragment of ["ebh_diag_u30r3", "10.9.8.7", "SELECT 1", "does not exist", DIAGNOSTIC]) {
        expect(surface).not.toContain(fragment);
      }
    }
  });
});

// =================================================================================================
// U30-R4 (owner 2026-10-03 (4) item 7; U30R3-VERIFICATION F1): the anti-downgrade binding. A canonical
// V4 assessment rewritten to V1-V3 (authority_evidence_ref dropped) and/or pointed at another
// assessment's outcome must not re-execute to PASS. Genuine V4 (25h), genuine historical V3 and the
// R1/R2 goldens keep passing. What cannot be told apart is pinned at the end as KNOWN_LIMITATION.
// =================================================================================================

describe("U30-R4: a canonical V4 assessment cannot be rewritten to V1-V3 and redirected to another outcome", () => {
  const ENV = [...LU_CANONICAL_AUTHORITY_ENV, "NODE_ENV", "APP_ENV"] as const;
  const saved = new Map<string, string | undefined>();
  beforeEach(() => { for (const name of ENV) saved.set(name, process.env[name]); });
  afterEach(() => {
    for (const name of ENV) {
      const value = saved.get(name);
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    __resetLuExecutionAuthorityVerifierForTests(null);
  });

  /** The product configuration: the dev/test bootstrap flag is never set by the product runtime. */
  function productConfig() {
    delete process.env.MPS_LU_BOOTSTRAP_ADMIT;
  }
  /**
   * Explicit test bootstrap (U30-R5, the K0 model): the flag AND NODE_ENV exactly "test" AND APP_ENV exactly
   * "test" -- set here in the test file, never as a global default. An unset APP_ENV is not a test process.
   */
  function devTestBootstrap() {
    process.env.MPS_LU_BOOTSTRAP_ADMIT = "1";
    process.env.NODE_ENV = "test";
    process.env.APP_ENV = "test";
  }
  function setEnv(name: string, value: string | undefined) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }

  /** A: one ebh HIGH and nothing else. B: no hit, ebh unavailable. Both genuine canonical V4 runs. */
  async function twoCanonical() {
    const repo = new InMemoryArtifactRepository();
    const authority = await createLuCanonicalAuthority(repo);
    const runA = await runLuCanonicalSubject(authority, await provisionLuCanonicalSubject(authority, "u30r4-a"), { evidence: [spatialEvidence("u30r4-a", "ebh")] });
    const runB = await runLuCanonicalSubject(authority, await provisionLuCanonicalSubject(authority, "u30r4-b"), {
      evidence: [],
      unavailable_layers: [{ dataset: "ebh", reason: "SOURCE_UNAVAILABLE" }],
    });
    expect(runA.assessment?.payload.assessment_contract_version).toBe("localization-assessment-v4"); // precondition
    expect(runB.assessment?.payload.assessment_contract_version).toBe("localization-assessment-v4");
    return { repo, authority, A: runA.assessment!, B: runB.assessment! };
  }

  type Payload = LocalizationAssessmentArtifact["payload"];
  /** The payload relabelled to an older contract: authority evidence dropped, version (and canonicalizer) rewritten. */
  function relabelled(payload: Payload, to: "v3" | "v2" | "v1"): Payload {
    const { authority_evidence_ref: _authority, assessment_contract_version: _version, canonicalizer_id: _canonicalizer, ...rest } = payload;
    if (to === "v1") return rest as Payload;
    return {
      ...rest,
      assessment_contract_version: to === "v3" ? "localization-assessment-v3" : "localization-assessment-v2",
      canonicalizer_id: "rfc8785-sha256-v1",
    } as Payload;
  }
  /** B's outcome, attestation and findings under A's payload (A's point, project and property kept). */
  function redirectedTo(A: LocalizationAssessmentArtifact, B: LocalizationAssessmentArtifact, overrides: Partial<Payload> = {}): Payload {
    return withFindings(
      { ...A.payload, execution_outcome_ref: B.payload.execution_outcome_ref, outcome_attestation_ref: B.payload.outcome_attestation_ref, evidence_refs: [], ...overrides },
      B.payload.findings,
    );
  }

  /**
   * The shape a V3 assessment had while V3 was the canonical product contract (2026-08-24 .. 2026-09-16):
   * a V3-subject execution whose execution identity was issued (it is in CAS), a v2 outcome, and an
   * assessment carrying the subject's localization point but no authority evidence. Today only the
   * general engine can still produce it; bootstrap admission is used to RUN it, never to verify it.
   */
  async function historicalCanonicalV3(name: string, repo = new InMemoryArtifactRepository()) {
    const authority = await createLuCanonicalAuthority(repo);
    const provisioned = await provisionLuCanonicalSubject(authority, name);
    const ev = spatialEvidence(name, "ebh");
    await repo.put({ artifact_id: ev.artifact_id, content_hash: ev.content_hash, body: ev });
    const { subject } = provisioned;
    process.env.MPS_LU_BOOTSTRAP_ADMIT = "1";
    const run = await runLuAssessmentViaKernel({
      site_id: subject.site_id,
      deterministic_seed: provisioned.seed,
      evidence: [ev],
      artifact_repository: repo,
      registry: authority.registry,
      identity_subject_v3: {
        project_context_binding_ref: subject.project_context_binding_ref,
        product_release_ref: subject.product_release_ref,
        execution_contract_version: subject.execution_contract_version,
        localization_geometry_ref: subject.localization_geometry_ref,
      },
      assessment_draft: {
        site_id: subject.site_id,
        project_context_ref: { artifact_id: `project-${subject.site_id}`, artifact_type: "LU_PROJECT_CONTEXT" },
        property_ref: { artifact_id: subject.site_id, artifact_type: "LU_PROPERTY_CONTEXT" },
        evidence_refs: [{ artifact_id: ev.artifact_id, artifact_type: ev.artifact_type }],
        system_summary: "U30-R4 historical canonical V3",
        localization_geometry_ref: subject.localization_geometry_ref,
      },
    });
    delete process.env.MPS_LU_BOOTSTRAP_ADMIT;
    expect(run.assessment?.payload.assessment_contract_version).toBe("localization-assessment-v3"); // precondition
    expect(run.manifest_id.startsWith("lu-manifest-v3-")).toBe(true);
    return { repo, authority, provisioned, H: run.assessment! };
  }

  /** A V3-subject execution run under bootstrap admission with NO issued identity (dev/test only). */
  async function bootstrapV3SubjectRun(name: string) {
    const repo = new InMemoryArtifactRepository();
    const ev = spatialEvidence(name, "water");
    await repo.put({ artifact_id: ev.artifact_id, content_hash: ev.content_hash, body: ev });
    const point = { artifact_id: `geometry-${name}`, artifact_type: "localization_geometry" };
    process.env.MPS_LU_BOOTSTRAP_ADMIT = "1";
    const run = await runLuAssessmentViaKernel({
      site_id: `property-${name}`,
      deterministic_seed: `seed-${name}`,
      evidence: [ev],
      artifact_repository: repo,
      identity_subject_v3: {
        project_context_binding_ref: { artifact_id: `binding-${name}`, artifact_type: "project_context_binding" },
        product_release_ref: { artifact_id: "release-u30r4", artifact_type: "product_release_manifest" },
        execution_contract_version: "lu-execution-identity-v1",
        localization_geometry_ref: point,
      },
      assessment_draft: { ...draft(), site_id: `property-${name}`, evidence_refs: [{ artifact_id: ev.artifact_id, artifact_type: ev.artifact_type }], localization_geometry_ref: point },
    });
    delete process.env.MPS_LU_BOOTSTRAP_ADMIT;
    expect(run.manifest_id.startsWith("lu-manifest-v3-")).toBe(true); // precondition
    return { repo, assessment: run.assessment! };
  }

  async function verify(repo: ArtifactRepositoryPort, assessment: { artifact_id: string }) {
    return reExecuteLocalizationAssessment({ assessmentArtifactId: assessment.artifact_id, artifactRepository: repo });
  }

  it("27a (F1, exact): A rewritten to V3 (authority dropped) and pointed at B's outcome, A's point kept -> DENY EXECUTION_SUBJECT_MISMATCH", async () => {
    const { repo, A, B } = await twoCanonical();
    productConfig();
    const forged = await storeUnderNewId(repo, A, relabelled(redirectedTo(A, B), "v3"));
    expect(forged.payload.findings.map((f) => f.finding_id)).toEqual(["finding-notchecked-ebh"]); // B's execution produced exactly this

    const r = await verify(repo, forged);
    expect(r.outcome).toBe("DENY");
    expect(r.mismatches.map((m) => m.code)).toEqual(["EXECUTION_SUBJECT_MISMATCH"]);
    expect(r.notices).toEqual([]);
  });

  for (const to of ["v2", "v1"] as const) {
    it(`27b (F1 to ${to.toUpperCase()}): A rewritten to ${to.toUpperCase()} and pointed at B's outcome -> DENY CONTRACT_DOWNGRADE_REFUSED`, async () => {
      const { repo, A, B } = await twoCanonical();
      productConfig();
      const forged = await storeUnderNewId(repo, A, relabelled(redirectedTo(A, B), to));

      const r = await verify(repo, forged);
      expect(r.outcome).toBe("DENY");
      expect(r.mismatches.map((m) => m.code)).toEqual(["CONTRACT_DOWNGRADE_REFUSED"]);
    });

    it(`27c (downgrade alone to ${to.toUpperCase()}): A relabelled ${to.toUpperCase()} over its OWN outcome -> DENY CONTRACT_DOWNGRADE_REFUSED (a v2 outcome postdates every V1/V2 assessment)`, async () => {
      const { repo, A } = await twoCanonical();
      productConfig();
      const forged = await storeUnderNewId(repo, A, relabelled(A.payload, to));

      const r = await verify(repo, forged);
      expect(r.outcome).toBe("DENY");
      expect(r.mismatches.map((m) => m.code)).toEqual(["CONTRACT_DOWNGRADE_REFUSED"]);
    });
  }

  it("27d: the dev/test bootstrap flag never excuses a bound mismatch or a downgrade", async () => {
    const { repo, A, B } = await twoCanonical();
    devTestBootstrap();
    const toV3 = await storeUnderNewId(repo, A, relabelled(redirectedTo(A, B), "v3"));
    const toV2 = await storeUnderNewId(repo, A, relabelled(A.payload, "v2"));

    expect((await verify(repo, toV3)).mismatches.map((m) => m.code)).toEqual(["EXECUTION_SUBJECT_MISMATCH"]);
    expect((await verify(repo, toV2)).mismatches.map((m) => m.code)).toEqual(["CONTRACT_DOWNGRADE_REFUSED"]);
  });

  it("27e: A rewritten to V3 and pointed at a BOOTSTRAP (non-canonical) execution whose outputs match -> DENY EXECUTION_SUBJECT_UNBOUND in the product configuration", async () => {
    const { repo, A } = await twoCanonical();
    process.env.MPS_LU_BOOTSTRAP_ADMIT = "1";
    const bootstrap = (await runLuAssessmentViaKernel({
      site_id: "reexec-u30r4-bootstrap-target",
      deterministic_seed: "seed:reexec-u30r4-bootstrap-target",
      evidence: [],
      unavailable_layers: [{ dataset: "ebh", reason: "SOURCE_UNAVAILABLE" }],
      artifact_repository: repo,
      assessment_draft: { ...draft(), site_id: "reexec-u30r4-bootstrap-target" },
    })).assessment!;
    productConfig();
    const forged = await storeUnderNewId(repo, A, relabelled(redirectedTo(A, bootstrap), "v3"));

    const r = await verify(repo, forged);
    expect(r.outcome).toBe("DENY");
    expect(r.mismatches.map((m) => m.code)).toEqual(["EXECUTION_SUBJECT_UNBOUND"]);
  });

  it("25h/R1/R2 neighbours: genuine V4 assessments still PASS in the product configuration", async () => {
    const { repo, A, B } = await twoCanonical();
    productConfig();
    for (const assessment of [A, B]) {
      const r = await verify(repo, assessment);
      expect(r.mismatches).toEqual([]);
      expect(r.outcome).toBe("PASS");
    }
  });

  it("27f: a genuine historical V3 (V3-subject execution, issued identity, the subject's point) still PASSes in the product configuration", async () => {
    const { repo, H } = await historicalCanonicalV3("u30r4-h");
    productConfig();
    const r = await verify(repo, H);
    expect(r.mismatches).toEqual([]);
    expect(r.outcome).toBe("PASS");
  });

  for (const [label, point] of [
    ["another localization point", { artifact_id: "geometry-u30r4-elsewhere", artifact_type: "localization_geometry" }],
    ["no localization point", undefined],
    // U30-R5 (U30R4-VERIFICATION V6, mutant V-N3): the point is compared by id AND artifact_type.
    ["the subject's point id under another artifact_type", { artifact_id: "geometry-u30r4-h", artifact_type: "localization_geometry_wu30r5" }],
  ] as const) {
    it(`27g: that historical V3 rewritten (new id) to carry ${label} -> DENY EXECUTION_SUBJECT_MISMATCH`, async () => {
      const { repo, H } = await historicalCanonicalV3("u30r4-h");
      productConfig();
      const { localization_geometry_ref: _point, ...withoutPoint } = H.payload;
      const forged = await storeUnderNewId(repo, H, (point ? { ...withoutPoint, localization_geometry_ref: point } : withoutPoint) as Payload);

      const r = await verify(repo, forged);
      expect(r.outcome).toBe("DENY");
      expect(r.mismatches.map((m) => m.code)).toEqual(["EXECUTION_SUBJECT_MISMATCH"]);
    });
  }

  it("27h: the manifest rewritten in place to name ANOTHER subject's issued identity (WORM bypass), the assessment carrying that subject's point -> DENY: the identity's subject does not derive this manifest", async () => {
    const { repo, authority, H } = await historicalCanonicalV3("u30r4-h");
    const other = await provisionLuCanonicalSubject(authority, "u30r4-other");
    productConfig();
    const outcome = await repo.resolve<{ attempt_ref: Ref }>(H.payload.execution_outcome_ref);
    const attempt = await repo.resolve<{ manifest_ref: Ref }>(outcome.attempt_ref);
    const store = (repo as unknown as { store: Map<string, { content_hash: unknown; body: Record<string, unknown> }> }).store;
    const manifestEntry = store.get(attempt.manifest_ref.artifact_id)!;
    store.set(attempt.manifest_ref.artifact_id, {
      content_hash: manifestEntry.content_hash,
      body: { ...manifestEntry.body, execution_identity_ref: { artifact_id: other.identity.artifact_id, artifact_type: "execution_identity" } },
    });
    const forged = await storeUnderNewId(repo, H, { ...H.payload, localization_geometry_ref: other.subject.localization_geometry_ref });

    const r = await verify(repo, forged);
    expect(r.outcome).toBe("DENY");
    expect(r.mismatches.map((m) => m.code)).toEqual(["EXECUTION_SUBJECT_MISMATCH"]);
  });

  it("27i: a storage fault reading the execution identity of a V3-subject execution is the typed technical error (OD-R2)", async () => {
    const { repo, provisioned, H } = await historicalCanonicalV3("u30r4-h");
    productConfig();
    const fault = new MimersArtifactObjectMissingError(provisioned.identity.artifact_id, "e".repeat(64), "get");
    const faulty = faultingRepository(repo, { resolve: (ref) => (ref.artifact_id === provisioned.identity.artifact_id ? fault : null) });

    expectStorageFault(await settle(verify(faulty, H)), "execution_identity", fault);
  });

  /** Faults (or answers not-found for) the manifest read that comes after the category-A replay wrote its REPLAY record. */
  function afterReplayManifestRepository(inner: ArtifactRepositoryPort, answer: (id: string) => unknown) {
    let replayWritten = false;
    return {
      put: async (artifact: Parameters<ArtifactRepositoryPort["put"]>[0]) => {
        replayWritten = true;
        return inner.put(artifact);
      },
      resolve: async <T,>(ref: Ref): Promise<T> => {
        if (replayWritten && ref.artifact_type === "execution_manifest") throw answer(ref.artifact_id);
        return inner.resolve<T>(ref as never);
      },
    } as ArtifactRepositoryPort;
  }

  it("27j: a storage fault on the binding's own manifest read is the typed technical error; a genuinely absent manifest there is DENY MANIFEST_ATTEMPT_MISMATCH", async () => {
    const { repo, H } = await historicalCanonicalV3("u30r4-h");
    productConfig();
    let fault: unknown = null;
    const faulty = afterReplayManifestRepository(repo, (id) => (fault ??= new MimersArtifactIndexReadError(id, `index/${id}.json`, "IO", "EIO: i/o error")));
    expectStorageFault(await settle(verify(faulty, H)), "execution_manifest", fault ?? Symbol("no fault raised"));

    const absent = afterReplayManifestRepository(repo, (id) => new Error(`Artifact not found: ${id}`));
    const r = await verify(absent, H);
    expect(r.outcome).toBe("DENY");
    expect(r.mismatches.map((m) => m.code)).toEqual(["MANIFEST_ATTEMPT_MISMATCH"]);
  });

  it("27k: a bootstrap V3 assessment over a legacy site-scoped execution (the R1 shape) PASSes only under the explicit dev/test flag; the product configuration refuses it", async () => {
    devTestBootstrap();
    const repo = new InMemoryArtifactRepository();
    const result = await runAssessment(repo, "reexec-u30r4-legacy", [spatialEvidence("u30r4-legacy", "water")]);
    expect((await verify(repo, result.assessment!)).outcome).toBe("PASS");

    productConfig();
    const r = await verify(repo, result.assessment!);
    expect(r.outcome).toBe("DENY");
    expect(r.mismatches.map((m) => m.code)).toEqual(["EXECUTION_SUBJECT_UNBOUND"]);
  });

  it("27s: a legacy site-scoped execution stays UNBOUND (no V3 subject to bind) even when an identity sits at its legacy id -- never a subject MISMATCH the dev/test flag could not allow", async () => {
    devTestBootstrap();
    const repo = new InMemoryArtifactRepository();
    const result = await runAssessment(repo, "reexec-u30r4-legacy-identity", [spatialEvidence("u30r4-legacy-identity", "water")]);
    // What a V1-era issuance put at the legacy id: an identity without any V3 subject.
    const legacyIdentity = { artifact_id: "lu-identity-reexec-u30r4-legacy-identity", artifact_type: "execution_identity", references: [] };
    await repo.put({ artifact_id: legacyIdentity.artifact_id, content_hash: sha256ContentHash(legacyIdentity), body: legacyIdentity });

    expect((await verify(repo, result.assessment!)).outcome).toBe("PASS");
    productConfig();
    expect((await verify(repo, result.assessment!)).mismatches.map((m) => m.code)).toEqual(["EXECUTION_SUBJECT_UNBOUND"]);
  });

  // MPS_LU_BOOTSTRAP_ADMIT / NODE_ENV / APP_ENV at verify time (U30-R5: the K0 model + the flag gate):
  //  - PASS only with the flag exactly "1" in an EXPLICIT test process (NODE_ENV exactly "test" AND APP_ENV exactly
  //    "test" or "ci"; exact matches, nothing trimmed or case-folded);
  //  - the flag absent, or present with another value inside an explicit test process -> UNBOUND (fail closed);
  //  - the flag PRESENT (any value, also "" or "0") outside an explicit test process -> verify refuses to run at all
  //    (BOOTSTRAP_ADMIT_FLAG_OUTSIDE_TEST, a typed configuration error -- never a verdict, never excusable).
  // Rows marked R4 were PASS or UNBOUND under U30-R4's looser allowance (NODE_ENV development, APP_ENV unset/""/
  // development were allowed): the integrated runtime runs exactly NODE_ENV=development with APP_ENV unset (V2).
  for (const [flag, nodeEnv, appEnv, expected] of [
    ["1", "test", "test", "PASS"],
    ["1", "test", "ci", "PASS"],
    [undefined, "test", "test", "UNBOUND"],
    [undefined, undefined, undefined, "UNBOUND"],
    [undefined, "development", undefined, "UNBOUND"],
    [undefined, "production", "production", "UNBOUND"],
    ["0", "test", "test", "UNBOUND"],
    ["true", "test", "ci", "UNBOUND"],
    ["", "test", "test", "UNBOUND"],
    ["1", "test", undefined, "REFUSED"], // R4: PASS
    ["1", "test", "", "REFUSED"], // R4: PASS
    ["1", "development", undefined, "REFUSED"], // R4: PASS -- the integrated runtime's configuration
    ["1", "development", "development", "REFUSED"], // R4: PASS
    ["1", "test", "development", "REFUSED"], // R4: PASS
    ["1", "development", "test", "REFUSED"], // R4: PASS
    ["1", undefined, undefined, "REFUSED"], // R4: UNBOUND
    ["1", "production", undefined, "REFUSED"], // R4: UNBOUND
    ["1", "production", "production", "REFUSED"],
    ["1", "test", "demo", "REFUSED"],
    ["1", "test", "production", "REFUSED"],
    ["1", "test", "staging", "REFUSED"],
    ["1", "test", "stage", "REFUSED"],
    ["1", "test", "preprod", "REFUSED"],
    ["1", "development", "prod", "REFUSED"],
    ["1", "test", "local", "REFUSED"],
    ["1", "test", "dev", "REFUSED"],
    ["1", "test", "TEST", "REFUSED"],
    ["1", "test", "CI", "REFUSED"],
    ["1", "test", " test", "REFUSED"],
    ["1", "test", "ci ", "REFUSED"],
    ["1", "TEST", "test", "REFUSED"],
    ["1", " test", "ci", "REFUSED"],
    ["0", "development", undefined, "REFUSED"], // R4: UNBOUND
    ["0", "production", "production", "REFUSED"], // R4: UNBOUND
    ["", "production", undefined, "REFUSED"], // R4: UNBOUND
    ["true", "test", undefined, "REFUSED"], // R4: UNBOUND
  ] as const) {
    it(`27l: bootstrap V3-subject execution (no issued identity), MPS_LU_BOOTSTRAP_ADMIT=${JSON.stringify(flag)} NODE_ENV=${JSON.stringify(nodeEnv)} APP_ENV=${JSON.stringify(appEnv)} -> ${expected === "PASS" ? "PASS" : expected === "UNBOUND" ? "DENY EXECUTION_SUBJECT_UNBOUND" : "refused BOOTSTRAP_ADMIT_FLAG_OUTSIDE_TEST"}`, async () => {
      const { repo, assessment } = await bootstrapV3SubjectRun("u30r4-boot");
      setEnv("MPS_LU_BOOTSTRAP_ADMIT", flag);
      setEnv("NODE_ENV", nodeEnv);
      setEnv("APP_ENV", appEnv);

      const settled = await settle(verify(repo, assessment));
      if (expected === "REFUSED") {
        expectFlagOutsideTestRefusal(settled);
        return;
      }
      expect(settled.ok, `expected a verdict, got ${String((settled as { error?: unknown }).error)}`).toBe(true);
      const r = (settled as { value: Awaited<ReturnType<typeof verify>> }).value;
      if (expected === "PASS") {
        expect(r.mismatches).toEqual([]);
        expect(r.outcome).toBe("PASS");
      } else {
        expect(r.outcome).toBe("DENY");
        expect(r.mismatches.map((m) => m.code)).toEqual(["EXECUTION_SUBJECT_UNBOUND"]);
      }
    });
  }

  // ---------------------------------------------------------------------------------------------
  // The outcome-level downgrade: a V1 outcome carries no lineage, so neither the K2 output binding nor
  // the subject binding above applies to it. A forger can mint one (a new CAS object) for any lineage-era
  // attempt. The pinned outcome must be the one the execution recorded -- the outcome category A replays.
  // ---------------------------------------------------------------------------------------------

  /** A V1-shaped outcome (the pre-2026-08-24 kernel's form) for `attemptRef`, stored as a NEW CAS object. */
  async function mintV1Outcome(repo: ArtifactRepositoryPort, attemptRef: Ref, outcomeId = `outcome-${attemptRef.artifact_id}`) {
    const body = { outcome_id: outcomeId, artifact_type: "execution_outcome" as const, attempt_ref: attemptRef, result: "success" as const };
    const content_hash = sha256ContentHash(body);
    await repo.put({ artifact_id: outcomeId, content_hash, body: { ...body, content_hash } });
    return { artifact_id: outcomeId, artifact_type: "execution_outcome" };
  }
  async function attemptOf(repo: ArtifactRepositoryPort, assessment: LocalizationAssessmentArtifact) {
    return (await repo.resolve<{ attempt_ref: Ref }>(assessment.payload.execution_outcome_ref)).attempt_ref;
  }

  it("27o: a genuine V4 kept V4 (A's own authority and point) but pinned to a MINTED V1 outcome of its own attempt, its HIGH dropped -> DENY CONTRACT_DOWNGRADE_REFUSED", async () => {
    const { repo, A } = await twoCanonical();
    productConfig();
    const minted = await mintV1Outcome(repo, await attemptOf(repo, A));
    const forged = await storeUnderNewId(repo, A, withFindings({ ...A.payload, execution_outcome_ref: minted, evidence_refs: [] }, []));
    expect(forged.payload.assessment_contract_version).toBe("localization-assessment-v4"); // precondition

    const r = await verify(repo, forged);
    expect(r.outcome).toBe("DENY");
    expect(r.mismatches.map((m) => m.code)).toEqual(["CONTRACT_DOWNGRADE_REFUSED"]);
  });

  it("27p: A rewritten to V3 and pinned to a MINTED V1 outcome of B's attempt -> DENY CONTRACT_DOWNGRADE_REFUSED", async () => {
    const { repo, A, B } = await twoCanonical();
    productConfig();
    const minted = await mintV1Outcome(repo, await attemptOf(repo, B));
    const forged = await storeUnderNewId(repo, A, relabelled(withFindings({ ...A.payload, execution_outcome_ref: minted, evidence_refs: [] }, []), "v3"));

    const r = await verify(repo, forged);
    expect(r.outcome).toBe("DENY");
    expect(r.mismatches.map((m) => m.code)).toEqual(["CONTRACT_DOWNGRADE_REFUSED"]);
  });

  /**
   * A genuine pre-2026-08-24 execution: the kernel then wrote a V1 outcome at the legacy locator and no
   * v2 outcome, and the assessment (no contract version) pinned it. Built from a bootstrap run whose v2
   * outcome is removed and replaced by the V1 outcome the old kernel would have written.
   */
  async function historicalV1Execution(name: string, repo: InMemoryArtifactRepository = new InMemoryArtifactRepository()) {
    process.env.MPS_LU_BOOTSTRAP_ADMIT = "1";
    const run = (await runAssessment(repo, name, [spatialEvidence(name, "water")])).assessment!;
    const attempt = await attemptOf(repo, run);
    (repo as unknown as { store: Map<string, unknown> }).store.delete(run.payload.execution_outcome_ref.artifact_id);
    const legacy = await mintV1Outcome(repo, attempt);
    const { assessment_contract_version: _v, canonicalizer_id: _c, ...v1Payload } = run.payload;
    const assessment = await storeUnderNewId(repo, run, { ...v1Payload, execution_outcome_ref: legacy } as Payload);
    delete process.env.MPS_LU_BOOTSTRAP_ADMIT;
    return { repo, attempt, assessment };
  }

  it("27q: a genuine historical V1 execution (V1 outcome at the legacy locator, no v2 outcome) with its V1 assessment still PASSes in the product configuration", async () => {
    const { repo, assessment } = await historicalV1Execution("reexec-u30r4-v1-era");
    productConfig();
    const r = await verify(repo, assessment);
    expect(r.mismatches).toEqual([]);
    expect(r.outcome).toBe("PASS");
  });

  it("27r: in that historical V1 execution, a V1 outcome minted under ANOTHER id for the same attempt -> DENY MANIFEST_ATTEMPT_MISMATCH (not the outcome the execution recorded)", async () => {
    const { repo, attempt, assessment } = await historicalV1Execution("reexec-u30r4-v1-era-other");
    productConfig();
    const other = await mintV1Outcome(repo, attempt, `outcome-${attempt.artifact_id}-other`);
    const forged = await storeUnderNewId(repo, assessment, { ...assessment.payload, execution_outcome_ref: other });

    const r = await verify(repo, forged);
    expect(r.outcome).toBe("DENY");
    expect(r.mismatches.map((m) => m.code)).toEqual(["MANIFEST_ATTEMPT_MISMATCH"]);
  });

  // KNOWN_LIMITATION (U30R4-REPORT): verify is consistency, not authenticity; it needs write access to
  // CAS + DB. These two forgeries PASS and are pinned so that closing them is a deliberate change.
  it("KNOWN_LIMITATION 27m: A rewritten to V3 over its OWN outcome with its own point PASSes -- indistinguishable from a genuine V3 made while V3 was canonical", async () => {
    const { repo, A } = await twoCanonical();
    productConfig();
    const forged = await storeUnderNewId(repo, A, relabelled(A.payload, "v3"));
    const r = await verify(repo, forged);
    expect(r.outcome).toBe("PASS");
    expect(forged.payload.findings).toEqual(A.payload.findings); // nothing it claims differs from A
  });

  it("KNOWN_LIMITATION 27n (R-2): B's whole result incl. B's point, relabelled V3 under A's project and property, PASSes -- the same residual as V4 itself", async () => {
    const { repo, A, B } = await twoCanonical();
    productConfig();
    const forged = await storeUnderNewId(repo, A, relabelled(redirectedTo(A, B, { localization_geometry_ref: B.payload.localization_geometry_ref }), "v3"));
    const r = await verify(repo, forged);
    expect(r.outcome).toBe("PASS");
    expect(forged.payload.project_context_ref).toEqual(A.payload.project_context_ref);
  });

  // ---------------------------------------------------------------------------------------------
  // U30-R5 (U30R4-VERIFICATION V1-V6; owner decisions 2026-10-03 (4) p.7 and (5)).
  // (2) The flag gate: MPS_LU_BOOTSTRAP_ADMIT present outside an explicit test process makes verify refuse to run
  //     at all -- before any CAS read -- with a typed configuration error; never a verdict, never excusable.
  // (3) KNOWN_LIMITATION: verify is consistency, not authenticity. The forms below PASS and are pinned so that
  //     closing them is a deliberate change -- NOT approved behaviour.
  // ---------------------------------------------------------------------------------------------

  /** Wraps a repository so every resolve/put is counted (the flag gate must refuse before the first one). */
  function countingRepository(inner: ArtifactRepositoryPort) {
    const calls: string[] = [];
    const repository: ArtifactRepositoryPort = {
      put: async (artifact) => {
        calls.push(`put:${artifact.artifact_id}`);
        return inner.put(artifact);
      },
      resolve: async <T,>(ref: Ref): Promise<T> => {
        calls.push(`resolve:${ref.artifact_id}`);
        return inner.resolve<T>(ref as never);
      },
    };
    return { repository, calls };
  }

  for (const [flag, nodeEnv, appEnv, label] of [
    ["1", "development", undefined, "the integrated runtime's configuration (V2)"],
    ["1", "production", "production", "a production process"],
    ["1", undefined, undefined, "nothing classified"],
    ["0", "development", undefined, "the flag present with another value"],
    ["", "production", undefined, "the flag present but empty"],
  ] as const) {
    it(`27u (flag gate): MPS_LU_BOOTSTRAP_ADMIT=${JSON.stringify(flag)} with NODE_ENV=${JSON.stringify(nodeEnv)} APP_ENV=${JSON.stringify(appEnv)} (${label}) -> verify refuses EVERY assessment before reading anything, even a genuine V4 and a downgrade it would DENY`, async () => {
      const { repo, A } = await twoCanonical();
      const downgraded = await storeUnderNewId(repo, A, relabelled(A.payload, "v2"));
      setEnv("MPS_LU_BOOTSTRAP_ADMIT", flag);
      setEnv("NODE_ENV", nodeEnv);
      setEnv("APP_ENV", appEnv);

      for (const assessment of [A, downgraded]) {
        const counting = countingRepository(repo);
        expectFlagOutsideTestRefusal(await settle(verify(counting.repository, assessment)));
        expect(counting.calls, "the gate must refuse before the first CAS read or write").toEqual([]);
      }
    });
  }

  it("27v (flag gate): the refusal names the conditions, never an environment value", async () => {
    const { repo, A } = await twoCanonical();
    setEnv("MPS_LU_BOOTSTRAP_ADMIT", "1");
    setEnv("NODE_ENV", "development");
    setEnv("APP_ENV", "prod-wu30r5-sentinel");
    const settled = await settle(verify(repo, A));
    expectFlagOutsideTestRefusal(settled);
    const message = String((settled as { error: Error }).error.message);
    expect(message.startsWith("BOOTSTRAP_ADMIT_FLAG_OUTSIDE_TEST:")).toBe(true);
    expect(message).not.toContain("prod-wu30r5-sentinel");
    expect(message).not.toContain("development");
  });

  /** Runs `flip` on the repository's FIRST call, i.e. after verify's first await. */
  function envFlippingRepository(inner: ArtifactRepositoryPort, flip: () => void): ArtifactRepositoryPort {
    let flipped = false;
    const once = () => {
      if (!flipped) {
        flipped = true;
        flip();
      }
    };
    return {
      put: async (artifact) => {
        once();
        return inner.put(artifact);
      },
      resolve: async <T,>(ref: Ref): Promise<T> => {
        once();
        return inner.resolve<T>(ref as never);
      },
    };
  }

  it("27t (U30R4-VERIFICATION V6, mutant V-N4): the allowance and the flag gate are decided ONCE, before verify's first await -- a later change of the environment does not change the call", async () => {
    const { repo, assessment } = await bootstrapV3SubjectRun("wu30r5-snapshot");
    // (a) explicit test bootstrap at call time; the process turns into a production one during the first CAS read.
    devTestBootstrap();
    const toProduction = envFlippingRepository(repo, () => {
      process.env.NODE_ENV = "production";
      process.env.APP_ENV = "production";
    });
    const a = await settle(verify(toProduction, assessment));
    expect(a.ok, "neither the gate nor the allowance may be read after the first await").toBe(true);
    expect((a as { value: Awaited<ReturnType<typeof verify>> }).value.outcome).toBe("PASS");

    // (b) the product configuration at call time; the flag and a test process appear during the first CAS read.
    productConfig();
    process.env.NODE_ENV = "production";
    process.env.APP_ENV = "production";
    const toTest = envFlippingRepository(repo, () => {
      process.env.MPS_LU_BOOTSTRAP_ADMIT = "1";
      process.env.NODE_ENV = "test";
      process.env.APP_ENV = "test";
    });
    const b = await verify(toTest, assessment);
    expect(b.mismatches.map((m) => m.code)).toEqual(["EXECUTION_SUBJECT_UNBOUND"]);
  });

  it("KNOWN_LIMITATION marker (LU_REEXECUTION_CONSISTENCY_NOT_AUTHENTICITY): the machine-readable record carries exactly the meaning and names every residual form -- NOT approved behaviour", async () => {
    // Its own module, deliberately not a package-root export (the root re-exports LuDeterministicReExecution
    // wholesale; the API boundary snapshot must not change). Imported dynamically so its absence fails only here.
    const markerModule = (await import("../src/execution/LuReExecutionKnownLimitation").catch(() => ({}))) as Record<string, unknown>;
    const marker = markerModule.LU_REEXECUTION_CONSISTENCY_KNOWN_LIMITATION as
      | {
          code: string;
          id: string;
          meaning_sv: string;
          residuals: readonly { id: string; form_sv: string; requires_sv: string }[];
          owner_decision: string;
        }
      | undefined;
    expect(marker, "LU_REEXECUTION_CONSISTENCY_KNOWN_LIMITATION is exported by LuReExecutionKnownLimitation.ts").toBeDefined();
    const packageRoot = await import("../src/index");
    expect(Object.keys(packageRoot), "the marker is not a package-root export").not.toContain("LU_REEXECUTION_CONSISTENCY_KNOWN_LIMITATION");
    expect(marker!.code).toBe("KNOWN_LIMITATION");
    expect(marker!.id).toBe("LU_REEXECUTION_CONSISTENCY_NOT_AUTHENTICITY");
    expect(marker!.meaning_sv).toBe(
      "verify är konsistens, inte äkthet; kräver skrivåtkomst till CAS + DB; kan inte stängas i grunden utan framåtriktad markör i körningskedjan eller attestationsverifiering",
    );
    expect(marker!.residuals.map((residual) => residual.id)).toEqual([
      "v1-format-outcome-redirect",
      "v3-relabel-own-execution",
      "subject-axes-not-compared",
      "fabricated-chain-never-run",
      "historical-v1-v2-unbound",
      "identity-minted-after-the-fact",
      "deleted-v2-outcome-minted-v1",
      "in-place-overwrite",
      "historical-cause-text",
      "outcome-attestation-not-checked",
    ]);
    for (const residual of marker!.residuals) {
      expect(residual.form_sv.length, residual.id).toBeGreaterThan(40);
      expect(residual.requires_sv.length, residual.id).toBeGreaterThan(10);
      expect(Object.isFrozen(residual), residual.id).toBe(true);
    }
    const v1Form = marker!.residuals[0]!;
    for (const fragment of ["V1, V2 eller V3", "tre nya CAS-objekt", "före 2026-08-24", "valfri punkt", "HIGH", "NODE_ENV=production"]) {
      expect(v1Form.form_sv, fragment).toContain(fragment);
    }
    expect(marker!.residuals[5]!.form_sv).toContain("EXECUTION_SUBJECT_UNBOUND");
    expect(marker!.residuals[6]!.requires_sv).toContain("WORM-förbikoppling eller dataförlust");
    expect(marker!.owner_decision).toContain("NOT approved behaviour");
    expect(Object.isFrozen(marker)).toBe(true);
    expect(Object.isFrozen(marker!.residuals)).toBe(true);
    // Nothing in it may claim authenticity: every "äkthet" is negated or a "must not be claimed as proof".
    const text = JSON.stringify(marker);
    expect(text.match(/äkthet/g)?.length).toBe((text.match(/inte äkthet|äkthetsbevis/g) ?? []).length);
  });

  /** A brand-new V1-format chain: manifest + attempt (attempt-<manifest>-1) + V1 outcome at the legacy locator. */
  async function mintV1FormatChain(repo: ArtifactRepositoryPort, manifestId: string) {
    const manifestBody = {
      manifest_id: manifestId,
      artifact_type: "execution_manifest",
      execution_identity_ref: { artifact_id: `lu-identity-wu30r5-${manifestId}`, artifact_type: "execution_identity" },
      parameters: { deterministic_seed: "wu30r5-minted", site_id: "wu30r5-minted" },
    };
    const manifestHash = sha256ContentHash(manifestBody);
    await repo.put({ artifact_id: manifestId, content_hash: manifestHash, body: { ...manifestBody, content_hash: manifestHash } });
    const attemptBody = {
      attempt_id: `attempt-${manifestId}-1`,
      artifact_type: "execution_attempt" as const,
      manifest_ref: { artifact_id: manifestId, artifact_type: "execution_manifest" },
      attempt_number: 1,
    };
    const attemptHash = sha256ContentHash(attemptBody);
    await repo.put({ artifact_id: attemptBody.attempt_id, content_hash: attemptHash, body: { ...attemptBody, content_hash: attemptHash } });
    return mintV1Outcome(repo, { artifact_id: attemptBody.attempt_id, artifact_type: "execution_attempt" });
  }
  const storeSize = (repo: InMemoryArtifactRepository) => (repo as unknown as { store: Map<string, unknown> }).store.size;
  const ELSEWHERE = { artifact_id: "geometry-wu30r5-elsewhere", artifact_type: "localization_geometry" };
  /** The product configuration as strictly as it gets: no flag, NODE_ENV and APP_ENV both "production". */
  function strictProduction() {
    productConfig();
    process.env.NODE_ENV = "production";
    process.env.APP_ENV = "production";
  }

  for (const to of ["v1", "v2", "v3"] as const) {
    for (const [shape, manifestId] of [
      ["legacy site-scoped manifest id", "lu-manifest-wu30r5-forged-site"],
      ["a fake lu-manifest-v3- id", `lu-manifest-v3-${"f".repeat(64)}`],
    ] as const) {
      it(`KNOWN_LIMITATION (V1-form, U30R4-VERIFICATION V1) -- NOT approved behaviour: a canonical V4 rewritten to ${to.toUpperCase()} and pinned to a MINTED V1-format chain (${shape}: three new CAS objects), another point, its HIGH removed -> PASS, even with NODE_ENV=production and APP_ENV=production`, async () => {
        const { repo, A } = await twoCanonical();
        expect(A.payload.findings.some((f) => f.risk_level === "HIGH")).toBe(true); // precondition: A has a HIGH
        const before = storeSize(repo);
        const minted = await mintV1FormatChain(repo, manifestId);
        expect(storeSize(repo) - before, "manifest + attempt + V1 outcome").toBe(3);
        const forged = await storeUnderNewId(
          repo,
          A,
          relabelled(withFindings({ ...A.payload, execution_outcome_ref: minted, evidence_refs: [], localization_geometry_ref: ELSEWHERE }, []), to),
        );
        expect(forged.payload.findings).toEqual([]);
        strictProduction();

        const r = await verify(repo, forged);
        // KNOWN_LIMITATION, pinned -- NOT approved behaviour: verify is consistency, not authenticity. When a forward
        // marker in the execution chain or attestation verification exists, this must become a DENY.
        expect(r.mismatches).toEqual([]);
        expect(r.outcome).toBe("PASS");
      });
    }
  }

  it("KNOWN_LIMITATION (V1-form (b), U30R4-VERIFICATION V1) -- NOT approved behaviour: a canonical V4 rewritten to V1 and pinned to a GENUINE pre-2026-08-24 execution of ANOTHER site (V1 outcome at the legacy locator), another point, its HIGH removed -> PASS in the strict production configuration", async () => {
    const { repo, A } = await twoCanonical();
    const other = await historicalV1Execution("wu30r5-v1-era-other-site", repo);
    const forged = await storeUnderNewId(
      repo,
      A,
      relabelled(
        withFindings({ ...A.payload, execution_outcome_ref: other.assessment.payload.execution_outcome_ref, evidence_refs: [], localization_geometry_ref: ELSEWHERE }, []),
        "v1",
      ),
    );
    strictProduction();
    const r = await verify(repo, forged);
    // KNOWN_LIMITATION, pinned -- NOT approved behaviour (see above).
    expect(r.mismatches).toEqual([]);
    expect(r.outcome).toBe("PASS");
  });

  it("KNOWN_LIMITATION (identity minted after the fact, U30R4-VERIFICATION V4) -- NOT approved behaviour: a bootstrap V3-subject execution is UNBOUND in the product configuration until someone mints the never-issued identity at the id its manifest names (one new CAS object, no WORM bypass) -> then PASS", async () => {
    const name = "wu30r5-minted-identity";
    const { repo, assessment } = await bootstrapV3SubjectRun(name);
    strictProduction();
    expect((await verify(repo, assessment)).mismatches.map((m) => m.code)).toEqual(["EXECUTION_SUBJECT_UNBOUND"]);

    const outcome = await repo.resolve<{ attempt_ref: Ref }>(assessment.payload.execution_outcome_ref);
    const attempt = await repo.resolve<{ manifest_ref: Ref }>(outcome.attempt_ref);
    const manifest = await repo.resolve<{ execution_identity_ref: Ref }>(attempt.manifest_ref);
    const subject_v3 = {
      site_id: `property-${name}`,
      project_context_binding_ref: { artifact_id: `binding-${name}`, artifact_type: "project_context_binding" },
      product_release_ref: { artifact_id: "release-u30r4", artifact_type: "product_release_manifest" },
      execution_contract_version: "lu-execution-identity-v1",
      localization_geometry_ref: assessment.payload.localization_geometry_ref!,
    };
    const minted = { artifact_id: manifest.execution_identity_ref.artifact_id, artifact_type: "execution_identity", subject_v3 };
    await repo.put({ artifact_id: minted.artifact_id, content_hash: sha256ContentHash(minted), body: minted });

    const r = await verify(repo, assessment);
    // KNOWN_LIMITATION, pinned -- NOT approved behaviour: UNBOUND is not a hard gate against a writer of CAS.
    expect(r.mismatches).toEqual([]);
    expect(r.outcome).toBe("PASS");
  });

  it("KNOWN_LIMITATION (deleted v2 outcome + minted V1 outcome, U30R4-VERIFICATION V5, R-3/R-4 class) -- NOT approved behaviour: a genuine V4 whose v2 outcome is removed in place and replaced by a minted V1 outcome at the legacy locator, its HIGH dropped -> PASS, still labelled V4", async () => {
    const { repo, A } = await twoCanonical();
    const attempt = await attemptOf(repo, A);
    // The removal is the WORM bypass (or data loss) this residual requires: nothing a forger can do through put().
    expect((repo as unknown as { store: Map<string, unknown> }).store.delete(A.payload.execution_outcome_ref.artifact_id)).toBe(true);
    const minted = await mintV1Outcome(repo, attempt);
    const forged = await storeUnderNewId(repo, A, withFindings({ ...A.payload, execution_outcome_ref: minted, evidence_refs: [] }, []));
    expect(forged.payload.assessment_contract_version).toBe("localization-assessment-v4");
    strictProduction();

    const r = await verify(repo, forged);
    // KNOWN_LIMITATION, pinned -- NOT approved behaviour.
    expect(r.mismatches).toEqual([]);
    expect(r.outcome).toBe("PASS");
  });
});
