/**
 * U20CDF2 (U20CDF verification G1-G3; owner's locked specification 2026-10-02 night) -- the "N av M"
 * invariant, exhaustively over constructed evidence combinations.
 *
 * Owner: run ALL relevant combinations of finding severity x evidence state x historical/current x
 * pinned/readable/unreadable and assert at least
 *   (1) a known risk never disappears,
 *   (2) historical unknown coverage never becomes 0,
 *   (3) unreadable pinned evidence never becomes "no hit",
 *   (4) a fresh valid assessment cannot produce a contradictory M count.
 *
 * Three parts, all over the REAL product functions:
 *  A. current runs: every provider outcome in the normal form for the five layers (6^5 spatial
 *     outcomes x 4 document states), through the fresh-run gate, the REAL LURuleEngine, the layer
 *     checks and the statement -- exhaustive;
 *  B. provider outcomes outside the normal form: always REJECT_SPATIAL_EVIDENCE_FORM before the
 *     rule engine (fail-closed);
 *  C. stored records read back through resolveGovernedAssessmentDetails (an in-memory CAS whose
 *     objects can be missing or fail to read): every per-layer state (12 evidence states x 6 finding
 *     states) on each of the five layers, against three backgrounds and five document states --
 *     exhaustive -- plus 2,000 seeded random records over all five layers at once.
 * U20CDF3 (U20CDF2 verification H7 / low 7): part C's oracle is rewritten from the owner's
 * specification and the producer contract (the gate + the rule engine), no longer a restatement of
 * the implementation's per-layer choices; part B2 adds a broad, generated set of invalid forms.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../server/db/prisma', async () => (await import('../helpers/hermeticPrismaGuard')).hermeticPrismaModule());

import { buildSpatialEvidenceContentHash, SPATIAL_STACK_V1, type AssessmentFinding } from '@miljobeslut/mps-lu';
import { LURuleEngine } from '../../packages/mps-lu/src/rules/LURuleEngine';
import { recomputeVerifiedDocumentFactContentHash } from '../../packages/mps-data-governance/src/verifyRealDocumentFactCandidate';
import { assertGovernedSpatialQueryOutcome, GovernedSpatialEvidenceFormError } from '../../server/modules/localization/governedSpatialEvidenceForm';
import {
  governedOverallStatement,
  presentedGovernedLayerChecks,
  resolveGovernedAssessmentDetails,
  type PresentedGovernedLayerCheck,
} from '../../server/modules/localization/governedEvidenceDetails';
import type { GovernedOverallStatement } from '../../server/modules/localization/governedEvidenceDetails';
import { hermeticPrismaTouches } from '../helpers/hermeticPrismaGuard';

afterEach(() => {
  expect(hermeticPrismaTouches).toEqual([]);
});

const LAYERS = ['water', 'ebh', 'protected_area', 'natura2000', 'water_protection_area'] as const;
type Layer = (typeof LAYERS)[number];
const RULE: Record<Layer, string> = {
  water: 'LU-WATER-001',
  ebh: 'LU-EBH-001',
  protected_area: 'LU-PROTECTED-001',
  natura2000: 'LU-NATURA2000-001',
  water_protection_area: 'LU-WATERPROTECTION-001',
};
const REGISTRY_HASH: Record<Layer, string> = {
  water: '2b4b514f8b18a1a614d9aeac75c32eff8c52a3864c54770be112fd88fa263ddc',
  ebh: '02fccffc07abaaf1775c8333d660fa60fdecea0c3bb664335892764c8486d186',
  protected_area: '983772bf129d14326c43aa5d08f152e65604778d392c28ea4fee0c4e838af9ae',
  natura2000: 'a5d665ae7bfde9ebeaa4883d5db7bbf70aea9cb7ad5a3f621c4cdbc003ad7f02',
  water_protection_area: 'ba6fdd88fa478d9b930a41153d03b84a34b086de8d6c5aa0f6b63c0b4dd6ff18',
};
const PROPERTY_REF = { artifact_id: 'lu-property-context-invariant', artifact_type: 'LU_PROPERTY_CONTEXT' } as const;
const LOCATION_REF = { artifact_id: 'localization-geometry-invariant', artifact_type: 'localization_geometry' } as const;
const DOC_RULE = 'LU-DOC-BESLUT-001';

const RISK_WORD: Record<string, string> = { HIGH: 'hög', MEDIUM: 'måttlig', LOW: 'låg' };
const RISK_PREFIX: Record<string, string> = { HIGH: 'Hög risk', MEDIUM: 'Måttlig risk', LOW: 'Låg risk' };
const HISTORICAL_SV = 'Täckningsgrad kan inte fastställas för denna historiska bedömning.';
const COUNT_PATTERN = /\b\d+ av \d+ kontroller/;

// ------------------------------------------------------------------------------------------------
// Evidence: built the way the provider builds it (V3 contract, content-addressed)
// ------------------------------------------------------------------------------------------------

type EvidenceState =
  | 'NONE'
  | 'NO_HIT'
  | 'NO_HIT_NOCOUNT'
  | 'HIT'
  | 'HIT_NOCOUNT'
  | 'HIT_CAP'
  | 'INV_HIT_COUNT0'
  | 'INV_NOHIT_COUNT3'
  | 'INV_EXISTS_STRING'
  | 'INV_KIND'
  | 'UNREADABLE_NOT_FOUND'
  | 'UNREADABLE_READ_ERROR';

const EVIDENCE_STATES: readonly EvidenceState[] = [
  'NONE', 'NO_HIT', 'NO_HIT_NOCOUNT', 'HIT', 'HIT_NOCOUNT', 'HIT_CAP',
  'INV_HIT_COUNT0', 'INV_NOHIT_COUNT3', 'INV_EXISTS_STRING', 'INV_KIND',
  'UNREADABLE_NOT_FOUND', 'UNREADABLE_READ_ERROR',
];
const VALID_HIT = new Set<EvidenceState>(['HIT', 'HIT_NOCOUNT', 'HIT_CAP']);
const VALID_NO_HIT = new Set<EvidenceState>(['NO_HIT', 'NO_HIT_NOCOUNT']);
const INVALID = new Set<EvidenceState>(['INV_HIT_COUNT0', 'INV_NOHIT_COUNT3', 'INV_EXISTS_STRING', 'INV_KIND']);
const UNREADABLE = new Set<EvidenceState>(['UNREADABLE_NOT_FOUND', 'UNREADABLE_READ_ERROR']);

function resultOf(state: EvidenceState): { kind: string; result: Record<string, unknown> } {
  const k = 'EXISTENCE_WITHIN_DISTANCE';
  switch (state) {
    case 'NO_HIT': return { kind: k, result: { exists: false, match_count_observed: 0, max_features_per_layer: 50 } };
    case 'NO_HIT_NOCOUNT': return { kind: k, result: { exists: false, max_features_per_layer: 50 } };
    case 'HIT': return { kind: k, result: { exists: true, match_count_observed: 3, max_features_per_layer: 50 } };
    case 'HIT_NOCOUNT': return { kind: k, result: { exists: true, max_features_per_layer: 50 } };
    case 'HIT_CAP': return { kind: k, result: { exists: true, match_count_observed: 50, max_features_per_layer: 50 } };
    case 'INV_HIT_COUNT0': return { kind: k, result: { exists: true, match_count_observed: 0, max_features_per_layer: 50 } };
    case 'INV_NOHIT_COUNT3': return { kind: k, result: { exists: false, match_count_observed: 3, max_features_per_layer: 50 } };
    case 'INV_EXISTS_STRING': return { kind: k, result: { exists: 'true', match_count_observed: 1, max_features_per_layer: 50 } };
    case 'INV_KIND': return { kind: 'FEATURE_GEOMETRY', result: { exists: true, match_count_observed: 1, max_features_per_layer: 50 } };
    // Unreadable evidence was a valid hit when it was pinned; the read-back cannot see it.
    case 'UNREADABLE_NOT_FOUND':
    case 'UNREADABLE_READ_ERROR': return { kind: k, result: { exists: true, match_count_observed: 2, max_features_per_layer: 50 } };
    default: throw new Error(`no evidence for ${state}`);
  }
}

const evidenceCache = new Map<string, SpatialEvidence>();
type SpatialEvidence = {
  artifact_id: string;
  artifact_type: 'SPATIAL_EVIDENCE';
  content_hash: { algorithm: string; value: string };
  references: unknown[];
  payload: Record<string, unknown> & { source_metadata: { dataset: string }; result_semantics: { result: unknown } };
};

function evidence(layer: Layer, state: EvidenceState): SpatialEvidence {
  const key = `${layer}:${state}`;
  const cached = evidenceCache.get(key);
  if (cached) return cached;
  const { kind, result } = resultOf(state);
  const payload = {
    result_semantics: { kind, query: { subject_ref: PROPERTY_REF, srid: 3006, distance_meters: 500 }, result },
    property_ref: PROPERTY_REF,
    srid: 3006,
    operation: { algorithm: 'spatial.dwithin_existence', engine: 'PostGIS', engine_fingerprint: SPATIAL_STACK_V1 },
    geometry: null,
    layer_ref: { layer_id: layer, version_hash: REGISTRY_HASH[layer], layer_version: 'v1.0' },
    source_metadata: { provider: 'Provider', dataset: layer, dataset_version: REGISTRY_HASH[layer], retrieved_at: '2026-10-02T10:00:00.000Z' },
    query_contract: {
      query_contract_version: 'spatial-query-contract-v3',
      spatial_canonical_version: 'sv-canonical-3',
      relation: 'DWITHIN',
      subject: { kind: 'LOCALIZATION_GEOMETRY', property_context_ref: PROPERTY_REF, location_ref: LOCATION_REF, crs: 'EPSG:3006' },
      parameters: { distance_meters: 500, max_features_per_layer: 50 },
      selection: { predicate_semantics: 'EXISTS' },
    },
  };
  const content_hash = buildSpatialEvidenceContentHash(payload as never);
  const built: SpatialEvidence = {
    artifact_id: `evidence-${layer}-${content_hash.value.slice(0, 16)}`,
    artifact_type: 'SPATIAL_EVIDENCE',
    content_hash,
    references: [PROPERTY_REF],
    payload: payload as SpatialEvidence['payload'],
  };
  evidenceCache.set(key, built);
  return built;
}

const ref = (artifact: { artifact_id: string; artifact_type: string }) => ({ artifact_id: artifact.artifact_id, artifact_type: artifact.artifact_type });

function readableDocumentEvidence(id: string) {
  return { artifact_id: id, artifact_type: 'DOCUMENT_EVIDENCE', content_hash: { algorithm: 'sha256', value: 'd'.repeat(64) }, references: [], payload: {} };
}

/** A self-consistent VERIFIED_DOCUMENT_FACT (same construction as the K0 read-model suite). */
function readableVerifiedFact(id: string) {
  const fact = {
    artifact_id: id,
    artifact_type: 'VERIFIED_DOCUMENT_FACT' as const,
    verification_status: 'VERIFIED' as const,
    fact_type: 'PRIOR_LOCATION_RESTRICTING_DECISION',
    fact_version: '1.0',
    source_document_ref: { id: 'source-document-inv', content_hash: { algorithm: 'sha256', digest: 'e'.repeat(64) } },
    inventory_ref: { id: 'inventory-inv', content_hash: { algorithm: 'sha256', digest: 'f'.repeat(64) } },
    source_span: { text_projection_ref: { id: 'projection-inv' }, start_offset: 0, end_offset: 10 },
    candidate_ref: { id: 'candidate-inv', content_hash: { algorithm: 'sha256', digest: '1'.repeat(64) } },
    assertion: {
      asserted_by: { identity_ref: { id: 'asserter-inv' }, role: 'MACHINE' },
      assertion_method: 'TEST_FIXTURE',
      asserter_version: '1',
      asserted_at: '2026-10-02T00:00:00.000Z',
    },
    verification: {
      verified_by: { identity_ref: { id: 'reviewer-inv' }, role: 'GOVERNANCE_REVIEWER' },
      verification_method: 'HUMAN_REVIEW',
      verification_policy_version: 'test-policy',
      verified_at: '2026-10-02T00:00:00.000Z',
    },
    signature: { algorithm: 'ed25519', key_id: 'test', value: 'sig' },
    content_hash: { algorithm: 'sha256', digest: '' },
  };
  fact.content_hash.digest = recomputeVerifiedDocumentFactContentHash(fact as never);
  return fact;
}
const DE = readableDocumentEvidence('doc-evidence-inv');
const VF = readableVerifiedFact('verified-fact-inv');

// ------------------------------------------------------------------------------------------------
// Shared assertions
// ------------------------------------------------------------------------------------------------

const RISK_ORDER = ['HIGH', 'MEDIUM', 'LOW'];
function maxRisk(findings: readonly { risk_level: string }[]): string | null {
  return RISK_ORDER.find((level) => findings.some((f) => f.risk_level === level)) ?? null;
}
/** governedVerdictFromFindings' overallRisk, restated: HIGH > MEDIUM > otherwise LOW. */
const machineRisk = (findings: readonly { risk_level: string }[]) => (findings.some((f) => f.risk_level === 'HIGH') ? 'HIGH' : findings.some((f) => f.risk_level === 'MEDIUM') ? 'MEDIUM' : 'LOW');

/** (1) a known risk never disappears -- overall and per layer. */
function assertKnownRiskNamed(
  label: string,
  statement: GovernedOverallStatement,
  rows: readonly PresentedGovernedLayerCheck[],
  findings: readonly { rule_id: string; risk_level: string }[],
) {
  const text = statement.statement_sv;
  const top = maxRisk(findings);
  const levelNamed = statement.coverage_state === 'DETERMINED' && (statement.coverage?.checks_completed ?? 0) > 0;
  if (top) {
    if (levelNamed) expect(text.startsWith(`${RISK_PREFIX[top]} i de kontroller som utfördes`), label).toBe(true);
    else {
      for (const level of RISK_ORDER) {
        if (findings.some((f) => f.risk_level === level)) expect(text, label).toContain(`risknivå ${RISK_WORD[level]}`);
      }
    }
  }
  for (const layer of LAYERS) {
    const layerRisk = maxRisk(findings.filter((f) => f.rule_id === RULE[layer]));
    if (!layerRisk) continue;
    const row = rows.find((r) => r.layer === layer)!;
    const completed = row.status === 'CHECKED_HIT';
    const namedAsTechnicalError = row.coverage_state === 'TECHNICAL_ERROR' && row.message_sv.includes(`risknivå ${RISK_WORD[layerRisk]}`);
    expect(completed || namedAsTechnicalError, `${label}: ${layer} has a stored ${layerRisk} finding but row ${JSON.stringify(row)}`).toBe(true);
  }
  // "Låg risk" only as the qualified level of a determined record with completed checks.
  if (/låg risk/i.test(text)) {
    expect(levelNamed && text.startsWith('Låg risk i de kontroller som utfördes'), label).toBe(true);
  }
}

// ------------------------------------------------------------------------------------------------
// A. current runs -- exhaustive over the provider outcomes in the normal form
// ------------------------------------------------------------------------------------------------

type FreshOutcome = EvidenceState | 'UNAVAILABLE';
const FRESH_OUTCOMES: readonly FreshOutcome[] = ['NO_HIT', 'NO_HIT_NOCOUNT', 'HIT', 'HIT_NOCOUNT', 'HIT_CAP', 'UNAVAILABLE'];
type DocumentState = 'NONE' | 'PINNED_WITH_FINDING' | 'PINNED_NO_FINDING' | 'DE_ONLY' | 'UNREADABLE_WITH_FINDING' | 'FINDING_NO_REFS';
const FRESH_DOCUMENT_STATES: readonly DocumentState[] = ['NONE', 'PINNED_WITH_FINDING', 'PINNED_NO_FINDING', 'DE_ONLY'];

function documentPart(state: DocumentState): { refs: { artifact_id: string; artifact_type: string }[]; findings: AssessmentFinding[] } {
  const docFinding: AssessmentFinding = {
    finding_id: `finding-doc-beslut-${DE.artifact_id}`, rule_id: DOC_RULE, rule_version: '1.0', risk_level: 'MEDIUM',
    explanation: 'x', evidence_refs: [ref(DE), ref(VF)],
  };
  switch (state) {
    case 'NONE': return { refs: [], findings: [] };
    // The rule engine's document rule fires exactly when DE + VF of the restricting type are pinned
    // (LURuleEngine.evaluateDocumentRules); OD-K0-3: DE + VF pinned without the finding is CHECKED_HIT too.
    case 'PINNED_WITH_FINDING': return { refs: [ref(DE), ref(VF)], findings: [docFinding] };
    case 'PINNED_NO_FINDING': return { refs: [ref(DE), ref(VF)], findings: [] };
    case 'DE_ONLY': return { refs: [ref(DE)], findings: [] };
    case 'UNREADABLE_WITH_FINDING': return { refs: [ref(DE), ref(VF)], findings: [docFinding] };
    case 'FINDING_NO_REFS': return { refs: [], findings: [{ ...docFinding, evidence_refs: [] }] };
  }
}

function* freshCombinations(): Generator<FreshOutcome[]> {
  const total = FRESH_OUTCOMES.length ** LAYERS.length;
  for (let n = 0; n < total; n += 1) {
    const combo: FreshOutcome[] = [];
    let rest = n;
    for (let i = 0; i < LAYERS.length; i += 1) {
      combo.push(FRESH_OUTCOMES[rest % FRESH_OUTCOMES.length]!);
      rest = Math.floor(rest / FRESH_OUTCOMES.length);
    }
    yield combo;
  }
}

describe('U20CDF2 invariant A: every current run in the normal form gives a consistent M count (4) and names its risk (1)', () => {
  it(`all ${FRESH_OUTCOMES.length ** LAYERS.length * FRESH_DOCUMENT_STATES.length} provider outcomes x document states`, () => {
    const engine = new LURuleEngine();
    let checked = 0;
    for (const combo of freshCombinations()) {
      const spatialEvidence = combo.flatMap((outcome, i) => (outcome === 'UNAVAILABLE' ? [] : [evidence(LAYERS[i]!, outcome)]));
      const unavailable = combo.flatMap((outcome, i) => (outcome === 'UNAVAILABLE' ? [{ dataset: LAYERS[i]!, reason: 'SOURCE_UNAVAILABLE' }] : []));
      assertGovernedSpatialQueryOutcome({ evidence: spatialEvidence, unavailable_layers: unavailable }, LAYERS);
      const spatialFindings = engine.evaluate({
        spatial_evidence: spatialEvidence as never,
        document_evidence: [],
        unavailable_layers: unavailable as never,
      });
      for (const documentState of FRESH_DOCUMENT_STATES) {
        const document = documentPart(documentState);
        const findings = [...spatialFindings, ...document.findings];
        const label = `fresh ${combo.join(',')} doc=${documentState}`;
        const rows = presentedGovernedLayerChecks({
          spatialEvidence: spatialEvidence as never,
          findings,
          pinnedEvidenceRefs: [...spatialEvidence.map(ref), ...document.refs],
        });
        const statement = governedOverallStatement(machineRisk(findings), rows, { findings });

        // (4) a current record is DETERMINED, and its count is exactly what the rule engine did.
        expect(statement.coverage_state, label).toBe('DETERMINED');
        expect(statement.coverage_basis, label).toEqual([]);
        combo.forEach((outcome, i) => {
          const row = rows[i]!;
          const risk = findings.some((f) => f.rule_id === RULE[LAYERS[i]!] && RISK_ORDER.includes(f.risk_level));
          if (outcome === 'UNAVAILABLE') expect([row.status, row.reason], label).toEqual(['NOT_CHECKED', 'NOT_CHECKED_FINDING']);
          else if (VALID_HIT.has(outcome)) expect([row.status, row.reason, risk], label).toEqual(['CHECKED_HIT', null, true]);
          else expect([row.status, row.reason, risk], label).toEqual(['CHECKED_NO_HIT', null, false]);
        });
        const documentDone = documentState === 'PINNED_WITH_FINDING' || documentState === 'PINNED_NO_FINDING';
        const expectedCompleted = combo.filter((o) => o !== 'UNAVAILABLE').length + (documentDone ? 1 : 0);
        expect(statement.coverage?.checks_completed, label).toBe(expectedCompleted);
        expect(statement.coverage?.checks_total, label).toBe(6);
        const mRisk = findings.some((f) => RISK_ORDER.includes(f.risk_level));
        if (expectedCompleted === 0) {
          expect(mRisk, label).toBe(false); // no M-layer finding can stand beside 0 of M
          expect(statement.statement_sv, label).toBe('Ingen samlad risknivå kan presenteras – 0 av 6 kontroller genomförda.');
        } else {
          expect(statement.statement_sv, label).toContain(`${expectedCompleted} av 6 kontroller genomförda`);
        }
        assertKnownRiskNamed(label, statement, rows, findings);
        checked += 1;
      }
    }
    expect(checked).toBe(FRESH_OUTCOMES.length ** LAYERS.length * FRESH_DOCUMENT_STATES.length);
  }, 120_000);
});

// ------------------------------------------------------------------------------------------------
// B. outside the normal form: fail-closed before the rule engine
// ------------------------------------------------------------------------------------------------

describe('U20CDF2 invariant B: a provider outcome outside the normal form never reaches the rule engine', () => {
  it('every invalid form on every layer, against every valid background -> REJECT_SPATIAL_EVIDENCE_FORM', () => {
    let rejected = 0;
    for (const background of ['NO_HIT', 'HIT', 'UNAVAILABLE'] as const) {
      for (const layer of LAYERS) {
        const others = LAYERS.filter((l) => l !== layer);
        const backgroundEvidence = background === 'UNAVAILABLE' ? [] : others.map((l) => evidence(l, background));
        const backgroundUnavailable = background === 'UNAVAILABLE' ? others.map((dataset) => ({ dataset, reason: 'SOURCE_UNAVAILABLE' })) : [];
        for (const state of INVALID) {
          expect(() =>
            assertGovernedSpatialQueryOutcome({ evidence: [...backgroundEvidence, evidence(layer, state)], unavailable_layers: backgroundUnavailable }, LAYERS),
          ).toThrow(/^REJECT_SPATIAL_EVIDENCE_FORM: /);
          rejected += 1;
        }
        // Evidence and an unavailable entry for the same layer.
        expect(() =>
          assertGovernedSpatialQueryOutcome({
            evidence: [...backgroundEvidence, evidence(layer, 'NO_HIT')],
            unavailable_layers: [...backgroundUnavailable, { dataset: layer, reason: 'SOURCE_UNAVAILABLE' }],
          }, LAYERS),
        ).toThrow(/^REJECT_SPATIAL_EVIDENCE_FORM: .* EVIDENCE_AND_UNAVAILABLE$/);
        rejected += 1;
      }
    }
    expect(rejected).toBe(3 * LAYERS.length * (INVALID.size + 1));
  });
});

// ------------------------------------------------------------------------------------------------
// B2 (U20CDF3, U20CDF2 verification H7 / low 7): a BROAD set of invalid forms -- null, undefined,
// NaN, negative, Infinity, fractional, strings, objects, arrays, extra/unknown fields, wrong types --
// generated, not hand-picked: each is rejected by the gate (typed class) and, stored, never reads as a
// checked layer. The admitted forms are enumerated too (positive control), so the rejection is not
// vacuous. Admitted = the frozen contract (SpatialResultSemantics.ts): result is exactly
// { exists: boolean, match_count_observed?: count, max_features_per_layer?: positive count } with
// count > 0 === exists and count <= max; kind absent (older evidence) or exactly
// EXISTENCE_WITHIN_DISTANCE; dataset exactly one requested layer.
// ------------------------------------------------------------------------------------------------

const KIND = 'EXISTENCE_WITHIN_DISTANCE';
const ABSENT = Symbol('absent');
type Maybe = unknown | typeof ABSENT;
/** Every kind of non-value and wrong-typed value a JSON-ish field can hold. */
const JUNK: readonly unknown[] = [null, undefined, Number.NaN, -1, 0, 1, -0.5, 1.5, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, '', 'x', 'true', 'false', '0', '3', true, false, {}, { value: true }, [], [0], [true]];

function rawEvidence(dataset: Maybe, semantics: Maybe, id = 'raw') {
  return {
    artifact_id: `evidence-raw-${id}`,
    artifact_type: 'SPATIAL_EVIDENCE',
    payload: {
      source_metadata: dataset === ABSENT ? {} : { dataset },
      ...(semantics === ABSENT ? {} : { result_semantics: semantics }),
    },
  };
}
const withResult = (result: Maybe, kind: Maybe = KIND) => ({ ...(kind === ABSENT ? {} : { kind }), ...(result === ABSENT ? {} : { result }) });
const resultOfFields = (fields: Record<string, Maybe>) =>
  Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== ABSENT)) as Record<string, unknown>;

/** The generated invalid evidence forms for one layer, each with a label. */
function invalidEvidenceForms(layer: Layer): Array<[string, unknown]> {
  const forms: Array<[string, unknown]> = [];
  // The evidence object itself and its payload.
  for (const junk of [null, undefined, 'x', 42, true, []]) forms.push([`evidence=${String(JSON.stringify(junk))}`, junk]);
  for (const junk of [null, 'x', 42, []]) forms.push([`payload=${JSON.stringify(junk)}`, { artifact_id: 'p', artifact_type: 'SPATIAL_EVIDENCE', payload: junk }]);
  // The dataset: missing, wrong type, empty, not a requested layer, mis-cased, padded.
  forms.push(['dataset absent', rawEvidence(ABSENT, withResult({ exists: false }))]);
  for (const junk of [null, undefined, '', 0, 1, true, {}, [], [layer]]) forms.push([`dataset=${String(JSON.stringify(junk))}`, rawEvidence(junk, withResult({ exists: false }))]);
  for (const name of [layer.toUpperCase(), ` ${layer}`, `${layer} `, `${layer}_x`, 'flood', 'document']) {
    forms.push([`dataset=${JSON.stringify(name)}`, rawEvidence(name, withResult({ exists: false }))]);
  }
  // result_semantics and kind.
  forms.push(['result_semantics absent', rawEvidence(layer, ABSENT)]);
  for (const junk of [null, 'x', 0, true, []]) forms.push([`result_semantics=${JSON.stringify(junk)}`, rawEvidence(layer, junk)]);
  for (const junk of [null, '', 'existence_within_distance', `${KIND} `, 'FEATURE_GEOMETRY', 'DISTANCE_WITNESS', 0, true, {}, []]) {
    forms.push([`kind=${JSON.stringify(junk)}`, rawEvidence(layer, withResult({ exists: false, match_count_observed: 0 }, junk))]);
  }
  // result.
  forms.push(['result absent', rawEvidence(layer, withResult(ABSENT))]);
  for (const junk of [null, 'x', 0, true, [], [{ exists: false }]]) forms.push([`result=${JSON.stringify(junk)}`, rawEvidence(layer, withResult(junk))]);
  // exists: anything but a boolean (also absent).
  forms.push(['exists absent', rawEvidence(layer, withResult({ match_count_observed: 0 }))]);
  for (const junk of JUNK.filter((v) => typeof v !== 'boolean')) {
    forms.push([`exists=${String(JSON.stringify(junk) ?? junk)}`, rawEvidence(layer, withResult({ exists: junk }))]);
  }
  // match_count_observed: anything but a non-negative integer (null/undefined = absent, admitted).
  for (const exists of [true, false]) {
    for (const junk of JUNK.filter((v) => v !== null && v !== undefined && !(typeof v === 'number' && Number.isInteger(v) && v >= 0))) {
      forms.push([`exists=${exists} count=${String(JSON.stringify(junk) ?? junk)}`, rawEvidence(layer, withResult({ exists, match_count_observed: junk }))]);
    }
  }
  // A count that contradicts exists.
  forms.push(['exists:true count 0', rawEvidence(layer, withResult({ exists: true, match_count_observed: 0 }))]);
  forms.push(['exists:false count 1', rawEvidence(layer, withResult({ exists: false, match_count_observed: 1 }))]);
  // max_features_per_layer: anything but a positive integer (null/undefined = absent); count above it.
  for (const junk of JUNK.filter((v) => v !== null && v !== undefined && !(typeof v === 'number' && Number.isInteger(v) && v > 0))) {
    forms.push([`max=${String(JSON.stringify(junk) ?? junk)}`, rawEvidence(layer, withResult({ exists: false, match_count_observed: 0, max_features_per_layer: junk }))]);
  }
  forms.push(['count above max', rawEvidence(layer, withResult({ exists: true, match_count_observed: 51, max_features_per_layer: 50 }))]);
  // Extra / unknown fields in the result (outside the frozen contract).
  for (const extra of ['foo', 'hit', 'matches', 'exists2', 'EXISTS', 'cap_reached', 'semantics_kind', '__proto__x']) {
    forms.push([`extra result field ${extra}`, rawEvidence(layer, withResult({ exists: false, match_count_observed: 0, max_features_per_layer: 50, [extra]: true }))]);
  }
  return forms;
}

/** Every admitted result form (positive control). */
function admittedResults(): Array<[string, Record<string, unknown>, boolean]> {
  const out: Array<[string, Record<string, unknown>, boolean]> = [];
  for (const exists of [true, false]) {
    for (const count of [ABSENT, null, exists ? 1 : 0, exists ? 50 : 0]) {
      for (const max of [ABSENT, null, 50]) {
        out.push([`exists=${exists} count=${String(count === ABSENT ? 'absent' : count)} max=${String(max === ABSENT ? 'absent' : max)}`,
          resultOfFields({ exists, match_count_observed: count, max_features_per_layer: max }), exists]);
      }
    }
  }
  return out;
}

describe('U20CDF3 invariant B2: a broad, generated set of invalid forms is rejected by the gate and never reads as a checked layer', () => {
  it('every generated invalid evidence form on every layer, against three backgrounds -> GovernedSpatialEvidenceFormError', () => {
    let rejected = 0;
    for (const background of ['NO_HIT', 'HIT', 'UNAVAILABLE'] as const) {
      for (const layer of LAYERS) {
        const others = LAYERS.filter((l) => l !== layer);
        const backgroundEvidence = background === 'UNAVAILABLE' ? [] : others.map((l) => evidence(l, background));
        const backgroundUnavailable = background === 'UNAVAILABLE' ? others.map((dataset) => ({ dataset, reason: 'SOURCE_UNAVAILABLE' })) : [];
        for (const [label, form] of invalidEvidenceForms(layer)) {
          let thrown: unknown = null;
          try {
            assertGovernedSpatialQueryOutcome({ evidence: [...backgroundEvidence, form], unavailable_layers: backgroundUnavailable }, LAYERS);
          } catch (error) {
            thrown = error;
          }
          expect(thrown, `${background} ${layer} ${label}`).toBeInstanceOf(GovernedSpatialEvidenceFormError);
          rejected += 1;
        }
      }
    }
    expect(rejected).toBeGreaterThan(3 * LAYERS.length * 100);
  });

  it('every generated invalid outcome-level form (unavailable entries, duplicates, silence, foreign layers) -> GovernedSpatialEvidenceFormError', () => {
    const negatives = LAYERS.map((l) => evidence(l, 'NO_HIT'));
    const cases: Array<[string, { evidence: unknown[]; unavailable_layers: unknown[] }]> = [];
    for (const junk of [null, undefined, 'x', 42, true, [], {}, { reason: 'x' }, { dataset: null }, { dataset: 0 }, { dataset: '' }, { dataset: [] }, { dataset: 'WATER' }, { dataset: 'flood' }]) {
      cases.push([`unavailable entry ${String(JSON.stringify(junk))}`, { evidence: negatives.slice(1), unavailable_layers: [{ dataset: 'water', reason: 'x' }, junk] }]);
    }
    for (const layer of LAYERS) {
      cases.push([`silent ${layer}`, { evidence: negatives.filter((e) => e.payload.source_metadata.dataset !== layer), unavailable_layers: [] }]);
      cases.push([`duplicate evidence ${layer}`, { evidence: [...negatives, evidence(layer, 'HIT')], unavailable_layers: [] }]);
      cases.push([`duplicate unavailable ${layer}`, {
        evidence: negatives.filter((e) => e.payload.source_metadata.dataset !== layer),
        unavailable_layers: [{ dataset: layer, reason: 'x' }, { dataset: layer, reason: 'y' }],
      }]);
      cases.push([`evidence and unavailable ${layer}`, { evidence: negatives, unavailable_layers: [{ dataset: layer, reason: 'x' }] }]);
    }
    cases.push(['everything silent', { evidence: [], unavailable_layers: [] }]);
    for (const [label, outcome] of cases) {
      let thrown: unknown = null;
      try {
        assertGovernedSpatialQueryOutcome(outcome, LAYERS);
      } catch (error) {
        thrown = error;
      }
      expect(thrown, label).toBeInstanceOf(GovernedSpatialEvidenceFormError);
    }
  });

  it('positive control: every admitted result form on every layer passes the gate and reads as checked', () => {
    let admitted = 0;
    for (const layer of LAYERS) {
      for (const [label, result, exists] of admittedResults()) {
        for (const kind of [ABSENT, KIND]) {
          const form = rawEvidence(layer, withResult(result, kind), `${layer}-${admitted}`);
          const others = LAYERS.filter((l) => l !== layer).map((l) => evidence(l, 'NO_HIT'));
          expect(() => assertGovernedSpatialQueryOutcome({ evidence: [...others, form], unavailable_layers: [] }, LAYERS), `${layer} ${label}`).not.toThrow();
          const rows = presentedGovernedLayerChecks({ spatialEvidence: [...others, form] as never, findings: [], pinnedEvidenceRefs: [] });
          expect(rows.find((r) => r.layer === layer)?.status, `${layer} ${label}`).toBe(exists ? 'CHECKED_HIT' : 'CHECKED_NO_HIT');
          admitted += 1;
        }
      }
    }
    expect(admitted).toBe(LAYERS.length * admittedResults().length * 2);
  });

  it('stored: every generated invalid form whose payload is an object never makes its layer a checked one, and never yields a count', () => {
    for (const layer of LAYERS) {
      const others = LAYERS.filter((l) => l !== layer).map((l) => evidence(l, 'NO_HIT'));
      for (const [label, form] of invalidEvidenceForms(layer)) {
        const payload = (form as { payload?: unknown } | null)?.payload;
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) continue; // never read back as SPATIAL_EVIDENCE
        const rows = presentedGovernedLayerChecks({ spatialEvidence: [...others, form] as never, findings: [], pinnedEvidenceRefs: [] });
        const row = rows.find((r) => r.layer === layer)!;
        expect(['CHECKED_HIT', 'CHECKED_NO_HIT'].includes(row.status), `${layer} ${label}: ${JSON.stringify(row)}`).toBe(false);
        expect(rows.map((r) => r.layer), `${layer} ${label}`).toEqual([...LAYERS, 'document']);
        const statement = governedOverallStatement('LOW', rows, { findings: [] });
        expect(statement.coverage, `${layer} ${label}`).toBeNull();
        expect(statement.statement_sv, `${layer} ${label}`).not.toMatch(COUNT_PATTERN);
      }
    }
  });
});

// ------------------------------------------------------------------------------------------------
// C. stored records through the read path -- U20CDF3 (U20CDF2 verification H7 / low 7): an oracle
// written from the owner's specification and the producer contract, NOT from the implementation
// ------------------------------------------------------------------------------------------------
//
// The U20CDF2 oracle restated the implementation's own per-layer choices (e.g. "NOT_CHECKED wins
// over evidence -> current", reproduced from the code). This one is derived from two sources only:
//
//  1. The owner's locked specification (2026-10-02 night), as four universal properties checked on
//     EVERY record, whatever the oracle says about its state:
//       (S1) a known risk never disappears -- every stored HIGH/MEDIUM/LOW is visible (overall or
//            named), and a finding of unknown severity is named too;
//       (S2) historical unknown coverage is never 0 -- a record that says nothing about a governed
//            layer never gets a count, and never "0 av M";
//       (S3) unreadable pinned evidence is never "no hit";
//       (S4) "N av M" only for a record whose coverage can be established; an invalid combination
//            fails closed as an integrity error ("ogiltig kombination fail-closed"); never an extra row.
//  2. What the current producer can write (the gate + the rule engine; read from their contracts,
//     not from governedLayerChecks.ts): per layer exactly one of
//       a. one valid negative evidence, no finding of the layer's rule          -> checked, no hit
//       b. one valid hit evidence + HIGH/MEDIUM/LOW finding(s), no NOT_CHECKED   -> checked, hit
//       c. no evidence + NOT_CHECKED finding(s) only                            -> not checked
//     and for the document check: nothing pinned and no document finding; DE + VF pinned (with or
//     without the document finding, OD-K0-3); DE only and no finding. Only for such a record can the
//     coverage be established, so only such a record gets a count -- and the count is exactly
//     (#a + #b + 1 if DE + VF pinned) of 6.
//  Invalid combinations no producer writes, by the owner's normal-form rule an integrity error:
//     a NOT_CHECKED finding beside stored evidence of the same layer; stored evidence of a dataset
//     outside the governed layers; two evidences for one layer (the gate admits one outcome per
//     layer); a finding whose severity is outside HIGH/MEDIUM/LOW/NOT_CHECKED.
//  Everything else outside the producer shapes (a silent layer, evidence outside the normal form, a
//  hit without its finding, a risk finding without the consistent evidence, a document finding
//  without the pinned documents) gets no count; the specification does not say which of the two
//  "not determinable" states it is, so the oracle does not either.
//  A finding of a rule outside the M checks is not described by the specification: such records are
//  checked against S1-S4 only.

type FindingState = 'NONE' | 'HIGH' | 'MEDIUM' | 'LOW' | 'NC' | 'HIGH_NC' | 'UNKNOWN_SEVERITY';
const FINDING_STATES: readonly FindingState[] = ['NONE', 'HIGH', 'MEDIUM', 'LOW', 'NC', 'HIGH_NC', 'UNKNOWN_SEVERITY'];
/** Two evidences for one layer: two negatives, or a hit and a negative. */
type StoredEvidenceState = EvidenceState | 'DUP_NO_HIT' | 'DUP_HIT_NO_HIT';
const STORED_EVIDENCE_STATES: readonly StoredEvidenceState[] = [...EVIDENCE_STATES, 'DUP_NO_HIT', 'DUP_HIT_NO_HIT'];
const UNKNOWN_SEVERITY_VALUES: readonly unknown[] = ['high', ' HIGH', 'CRITICAL', '', null, 3];
const DOCUMENT_STATES: readonly DocumentState[] = ['NONE', 'PINNED_WITH_FINDING', 'PINNED_NO_FINDING', 'DE_ONLY', 'UNREADABLE_WITH_FINDING', 'FINDING_NO_REFS'];
type LayerRecord = { readonly evidence: StoredEvidenceState; readonly finding: FindingState; readonly unknownValue?: unknown };
type StoredRecord = {
  readonly layers: Record<Layer, LayerRecord>;
  readonly document: DocumentState;
  readonly otherRule: boolean;
  /** Stored, readable evidence of a dataset outside the governed layers. */
  readonly foreign: null | 'flood' | 'WATER';
};

type OracleVerdict =
  | { readonly kind: 'UNREADABLE'; readonly lasting: boolean }
  | { readonly kind: 'COUNT'; readonly completed: number }
  | { readonly kind: 'NO_COUNT'; readonly integrity: boolean }
  | { readonly kind: 'ANY' };

const RISK_FINDINGS = new Set<FindingState>(['HIGH', 'MEDIUM', 'LOW']);

/** The oracle (see the header of this part): from the specification and the producer contract. */
function specOracle(record: StoredRecord): OracleVerdict {
  const layerStates = LAYERS.map((l) => record.layers[l]);
  // (S3) an unreadable pinned object: a technical/integrity error, never a recount.
  const unreadable = layerStates.some((s) => UNREADABLE.has(s.evidence as EvidenceState)) || record.document === 'UNREADABLE_WITH_FINDING';
  if (unreadable) {
    const lasting = layerStates.some((s) => s.evidence === 'UNREADABLE_NOT_FOUND') || record.document === 'UNREADABLE_WITH_FINDING';
    return { kind: 'UNREADABLE', lasting };
  }
  // (S4) invalid combinations no producer writes: fail-closed as an integrity error.
  const invalidCombination =
    record.foreign !== null ||
    layerStates.some((s) => s.finding === 'UNKNOWN_SEVERITY') ||
    layerStates.some((s) => s.evidence === 'DUP_NO_HIT' || s.evidence === 'DUP_HIT_NO_HIT') ||
    layerStates.some((s) => (s.finding === 'NC' || s.finding === 'HIGH_NC') && s.evidence !== 'NONE');
  if (invalidCombination) return { kind: 'NO_COUNT', integrity: true };
  // The producer shapes.
  let completed = 0;
  for (const { evidence: ev, finding } of layerStates) {
    if (VALID_NO_HIT.has(ev as EvidenceState) && finding === 'NONE') completed += 1; // a
    else if (VALID_HIT.has(ev as EvidenceState) && RISK_FINDINGS.has(finding)) completed += 1; // b
    else if (ev === 'NONE' && finding === 'NC') continue; // c
    else return record.otherRule ? { kind: 'ANY' } : { kind: 'NO_COUNT', integrity: false };
  }
  const documentShape = record.document === 'NONE' || record.document === 'PINNED_WITH_FINDING' || record.document === 'PINNED_NO_FINDING' || record.document === 'DE_ONLY';
  if (!documentShape) return record.otherRule ? { kind: 'ANY' } : { kind: 'NO_COUNT', integrity: false };
  if (record.otherRule) return { kind: 'ANY' };
  return { kind: 'COUNT', completed: completed + (record.document === 'PINNED_WITH_FINDING' || record.document === 'PINNED_NO_FINDING' ? 1 : 0) };
}

/** Readable evidence of a dataset outside the governed layers, content-addressed like the provider's. */
function foreignEvidence(dataset: string): SpatialEvidence {
  const key = `foreign:${dataset}`;
  const cached = evidenceCache.get(key);
  if (cached) return cached;
  const base = evidence('water', 'HIT');
  const payload = {
    ...base.payload,
    layer_ref: { layer_id: dataset, version_hash: REGISTRY_HASH.water, layer_version: 'v1.0' },
    source_metadata: { ...base.payload.source_metadata, dataset },
  };
  const content_hash = buildSpatialEvidenceContentHash(payload as never);
  const built: SpatialEvidence = { ...base, artifact_id: `evidence-${dataset}-${content_hash.value.slice(0, 16)}`, content_hash, payload: payload as SpatialEvidence['payload'] };
  evidenceCache.set(key, built);
  return built;
}

async function readStored(record: StoredRecord) {
  const store = new Map<string, unknown>();
  const failing = new Set<string>();
  const refs: { artifact_id: string; artifact_type: string }[] = [];
  const findings: AssessmentFinding[] = [];
  for (const layer of LAYERS) {
    const { evidence: state, finding, unknownValue } = record.layers[layer];
    const pinned: SpatialEvidence[] =
      state === 'NONE' ? []
        : state === 'DUP_NO_HIT' ? [evidence(layer, 'NO_HIT'), evidence(layer, 'NO_HIT_NOCOUNT')]
          : state === 'DUP_HIT_NO_HIT' ? [evidence(layer, 'HIT'), evidence(layer, 'NO_HIT')]
            : [evidence(layer, state)];
    for (const ev of pinned) {
      refs.push(ref(ev));
      if (state === 'UNREADABLE_READ_ERROR') {
        store.set(ev.artifact_id, ev);
        failing.add(ev.artifact_id);
      } else if (state !== 'UNREADABLE_NOT_FOUND') {
        store.set(ev.artifact_id, ev);
      }
    }
    const cited = pinned.map(ref);
    const levels: unknown[] =
      finding === 'HIGH_NC' ? ['HIGH', 'NOT_CHECKED']
        : finding === 'NC' ? ['NOT_CHECKED']
          : finding === 'NONE' ? []
            : finding === 'UNKNOWN_SEVERITY' ? [unknownValue ?? 'high']
              : [finding];
    levels.forEach((level, index) => {
      findings.push({
        finding_id: level === 'NOT_CHECKED' ? `finding-notchecked-${layer}` : `finding-${layer}-${index}`,
        rule_id: RULE[layer], rule_version: '2.0', risk_level: level as AssessmentFinding['risk_level'],
        explanation: 'x', evidence_refs: level === 'NOT_CHECKED' ? [] : cited,
      });
    });
  }
  if (record.foreign) {
    const ev = foreignEvidence(record.foreign);
    refs.push(ref(ev));
    store.set(ev.artifact_id, ev);
  }
  const document = documentPart(record.document);
  refs.push(...document.refs);
  findings.push(...document.findings);
  if (record.document === 'PINNED_WITH_FINDING' || record.document === 'PINNED_NO_FINDING' || record.document === 'DE_ONLY') {
    store.set(DE.artifact_id, DE);
    store.set(VF.artifact_id, VF);
  }
  if (record.otherRule) {
    findings.push({ finding_id: 'finding-other', rule_id: 'LU-GOVERNED-001', rule_version: '1', risk_level: 'MEDIUM', explanation: 'x', evidence_refs: [] });
  }
  const repository = {
    async resolve<T>(r: { artifact_id: string }): Promise<T> {
      if (failing.has(r.artifact_id)) throw new Error('EIO: i/o error, read');
      const value = store.get(r.artifact_id);
      if (!value) throw new Error(`Artifact not found: ${r.artifact_id}`);
      return structuredClone(value) as T;
    },
  };
  const details = await resolveGovernedAssessmentDetails({
    assessment: { payload: { findings, evidence_refs: refs } } as never,
    artifactRepository: repository as never,
  });
  expect(details.integrity).toEqual({ ok: true });
  const statement = governedOverallStatement(machineRisk(findings), details.governedLayerChecks, {
    findings,
    pinnedEvidence: details.pinnedEvidence,
  });
  return { details, statement, findings };
}

async function assertStored(record: StoredRecord): Promise<{ verdict: OracleVerdict; state: string }> {
  const label =
    `stored ${LAYERS.map((l) => `${l}=${record.layers[l].evidence}/${record.layers[l].finding}`).join(' ')} ` +
    `doc=${record.document} other=${record.otherRule} foreign=${record.foreign}`;
  const { details, statement, findings } = await readStored(record);
  const rows = details.governedLayerChecks;
  const verdict = specOracle(record);
  const text = statement.statement_sv;

  // (S4) never an extra row: exactly the five governed layers and the document check.
  expect(rows.map((r) => r.layer), label).toEqual([...LAYERS, 'document']);
  // The machine level is the one derivation the fresh run uses (OD-K0-1), unchanged.
  expect(statement.risk_level, label).toBe(machineRisk(findings));

  switch (verdict.kind) {
    case 'UNREADABLE':
      expect(statement.coverage_state, label).toBe('PINNED_EVIDENCE_UNREADABLE');
      expect(text.startsWith('Den pinnade evidensen kan inte verifieras: '), label).toBe(true);
      expect(statement.pinned_evidence?.retryable, label).toBe(!verdict.lasting);
      expect(statement.pinned_evidence?.technical_error_class, label).toBe(verdict.lasting ? 'EVIDENCE_NOT_FOUND' : 'EVIDENCE_READ_ERROR');
      break;
    case 'COUNT':
      expect(statement.coverage_state, label).toBe('DETERMINED');
      expect(statement.coverage?.checks_total, label).toBe(6);
      expect(statement.coverage?.checks_completed, label).toBe(verdict.completed);
      if (verdict.completed === 0) expect(text, label).toBe('Ingen samlad risknivå kan presenteras – 0 av 6 kontroller genomförda.');
      else expect(text, label).toContain(`${verdict.completed} av 6 kontroller genomförda`);
      break;
    case 'NO_COUNT':
      if (verdict.integrity) {
        expect(statement.coverage_state, label).toBe('RECORD_INTEGRITY_ERROR');
        expect(text.startsWith('Integritetsfel: '), label).toBe(true);
      } else {
        expect(['HISTORICAL_COVERAGE_UNKNOWN', 'RECORD_INTEGRITY_ERROR'], label).toContain(statement.coverage_state);
      }
      if (statement.coverage_state === 'HISTORICAL_COVERAGE_UNKNOWN') expect(text.startsWith(HISTORICAL_SV), label).toBe(true);
      break;
    case 'ANY':
      break;
  }
  // (S2)/(S4) a count only for a determined record: never "N av M" -- in particular never "0 av M" --
  // for any other state, and none at all when a governed layer is unrecorded.
  if (statement.coverage_state !== 'DETERMINED') {
    expect(statement.coverage, label).toBeNull();
    expect(text, label).not.toMatch(COUNT_PATTERN);
    expect(text, label).not.toMatch(/Ingen samlad risknivå kan presenteras/);
  }
  if (LAYERS.some((l) => record.layers[l].evidence === 'NONE' && record.layers[l].finding === 'NONE')) {
    expect(statement.coverage, `${label}: a silent layer`).toBeNull();
    expect(text, `${label}: a silent layer`).not.toMatch(/\b0 av \d/);
  }
  // (S3) an unreadable layer is never "no hit".
  for (const layer of LAYERS) {
    const row = rows.find((r) => r.layer === layer)!;
    if (UNREADABLE.has(record.layers[layer].evidence as EvidenceState)) {
      expect(row.status === 'CHECKED_NO_HIT' || row.message_sv.includes('Ingen registrerad träff'), `${label}: ${layer}`).toBe(false);
    }
    // "No hit" only with exactly one readable, valid negative evidence and no finding of the layer.
    if (row.status === 'CHECKED_NO_HIT') {
      expect(VALID_NO_HIT.has(record.layers[layer].evidence as EvidenceState) && record.layers[layer].finding === 'NONE', `${label}: ${layer}`).toBe(true);
    }
  }
  // (S1) a known risk never disappears; and a finding of unknown severity is named, never ignored.
  assertKnownRiskNamed(label, statement, rows, findings);
  if (LAYERS.some((l) => record.layers[l].finding === 'UNKNOWN_SEVERITY')) {
    expect(text, label).toContain('okänd allvarlighetsgrad');
  }
  return { verdict, state: statement.coverage_state };
}

function layersWith(background: LayerRecord, target: Layer, state: LayerRecord): Record<Layer, LayerRecord> {
  return Object.fromEntries(LAYERS.map((l) => [l, l === target ? state : background])) as Record<Layer, LayerRecord>;
}

describe('U20CDF3 invariant C: stored records read back against an oracle written from the specification', () => {
  const BACKGROUNDS: Record<string, LayerRecord> = {
    current: { evidence: 'NO_HIT', finding: 'NONE' },
    notChecked: { evidence: 'NONE', finding: 'NC' },
    silent: { evidence: 'NONE', finding: 'NONE' },
  };

  it(`every per-layer state (${STORED_EVIDENCE_STATES.length} evidence x ${FINDING_STATES.length} findings) on every layer x 3 backgrounds x ${DOCUMENT_STATES.length} document states`, async () => {
    let checked = 0;
    for (const [, background] of Object.entries(BACKGROUNDS)) {
      for (const target of LAYERS) {
        for (const ev of STORED_EVIDENCE_STATES) {
          for (const finding of FINDING_STATES) {
            for (const document of DOCUMENT_STATES) {
              await assertStored({ layers: layersWith(background, target, { evidence: ev, finding }), document, otherRule: false, foreign: null });
              checked += 1;
            }
          }
        }
      }
    }
    expect(checked).toBe(3 * LAYERS.length * STORED_EVIDENCE_STATES.length * FINDING_STATES.length * DOCUMENT_STATES.length);
  }, 180_000);

  it('3,000 seeded random records over all five layers at once (foreign datasets, unknown severities, a rule outside M)', async () => {
    // mulberry32, fixed seed: deterministic.
    let seed = 0x20cdf3;
    const random = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const pick = <T,>(values: readonly T[]) => values[Math.floor(random() * values.length)]!;
    // Half of the layer draws are producer shapes, so whole-record COUNT verdicts are reached often.
    const PRODUCER_LAYER_STATES: readonly LayerRecord[] = [
      { evidence: 'NO_HIT', finding: 'NONE' }, { evidence: 'NO_HIT_NOCOUNT', finding: 'NONE' },
      { evidence: 'HIT', finding: 'HIGH' }, { evidence: 'HIT_NOCOUNT', finding: 'MEDIUM' }, { evidence: 'HIT_CAP', finding: 'LOW' },
      { evidence: 'NONE', finding: 'NC' },
    ];
    const drawLayer = (): LayerRecord =>
      random() < 0.55
        ? pick(PRODUCER_LAYER_STATES)
        : { evidence: pick(STORED_EVIDENCE_STATES), finding: pick(FINDING_STATES), unknownValue: pick(UNKNOWN_SEVERITY_VALUES) };
    const seen = new Set<string>();
    const states = new Set<string>();
    for (let n = 0; n < 3000; n += 1) {
      const layers = Object.fromEntries(LAYERS.map((l) => [l, drawLayer()])) as Record<Layer, LayerRecord>;
      const record: StoredRecord = {
        layers,
        document: random() < 0.6 ? pick(['NONE', 'PINNED_WITH_FINDING', 'PINNED_NO_FINDING', 'DE_ONLY'] as const) : pick(DOCUMENT_STATES),
        otherRule: random() < 0.15,
        foreign: random() < 0.1 ? pick(['flood', 'WATER'] as const) : null,
      };
      const { verdict, state } = await assertStored(record);
      seen.add(verdict.kind === 'NO_COUNT' ? `NO_COUNT:${verdict.integrity}` : verdict.kind);
      states.add(state);
    }
    // The sample reaches every oracle verdict and every record state the read path can produce.
    expect([...seen].sort()).toEqual(['ANY', 'COUNT', 'NO_COUNT:false', 'NO_COUNT:true', 'UNREADABLE']);
    expect([...states].sort()).toEqual(['DETERMINED', 'HISTORICAL_COVERAGE_UNKNOWN', 'PINNED_EVIDENCE_UNREADABLE', 'RECORD_INTEGRITY_ERROR']);
  }, 180_000);
});
