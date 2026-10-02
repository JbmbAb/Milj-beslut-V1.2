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
 * The expected coverage state in C comes from an oracle written from the specification (what a
 * current run can produce), not from the implementation.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../server/db/prisma', async () => (await import('../helpers/hermeticPrismaGuard')).hermeticPrismaModule());

import { buildSpatialEvidenceContentHash, SPATIAL_STACK_V1, type AssessmentFinding } from '@miljobeslut/mps-lu';
import { LURuleEngine } from '../../packages/mps-lu/src/rules/LURuleEngine';
import { recomputeVerifiedDocumentFactContentHash } from '../../packages/mps-data-governance/src/verifyRealDocumentFactCandidate';
import { assertGovernedSpatialQueryOutcome } from '../../server/modules/localization/governedSpatialEvidenceForm';
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
// C. stored records through the read path
// ------------------------------------------------------------------------------------------------

type FindingState = 'NONE' | 'HIGH' | 'MEDIUM' | 'LOW' | 'NC' | 'HIGH_NC';
const FINDING_STATES: readonly FindingState[] = ['NONE', 'HIGH', 'MEDIUM', 'LOW', 'NC', 'HIGH_NC'];
const DOCUMENT_STATES: readonly DocumentState[] = ['NONE', 'PINNED_WITH_FINDING', 'PINNED_NO_FINDING', 'UNREADABLE_WITH_FINDING', 'FINDING_NO_REFS'];
type LayerRecord = { readonly evidence: EvidenceState; readonly finding: FindingState };
type StoredRecord = { readonly layers: Record<Layer, LayerRecord>; readonly document: DocumentState; readonly otherRule: boolean };

/** The oracle, from the specification: what the coverage state of such a record must be. */
function expectedCoverageState(record: StoredRecord): 'PINNED_EVIDENCE_UNREADABLE' | 'RECORD_INTEGRITY_ERROR' | 'HISTORICAL_COVERAGE_UNKNOWN' | 'DETERMINED' {
  if (LAYERS.some((l) => UNREADABLE.has(record.layers[l].evidence)) || record.document === 'UNREADABLE_WITH_FINDING') {
    return 'PINNED_EVIDENCE_UNREADABLE';
  }
  // U20CDF3 (low 4): a NOT_CHECKED finding next to stored evidence for the same layer is an invalid
  // combination (no known producer writes it) -- formerly "NC wins" and the record counted as current.
  if (LAYERS.some((l) => (record.layers[l].finding === 'NC' || record.layers[l].finding === 'HIGH_NC') && record.layers[l].evidence !== 'NONE')) {
    return 'RECORD_INTEGRITY_ERROR';
  }
  for (const layer of LAYERS) {
    const { evidence: ev, finding } = record.layers[layer];
    const risk = finding === 'HIGH' || finding === 'MEDIUM' || finding === 'LOW' || finding === 'HIGH_NC';
    const notChecked = finding === 'NC' || finding === 'HIGH_NC';
    if (risk) {
      // A current run pins exactly one valid hit with every risk finding, never a NOT_CHECKED beside it.
      if (!(VALID_HIT.has(ev) && !notChecked)) return 'HISTORICAL_COVERAGE_UNKNOWN';
      continue;
    }
    if (notChecked) continue; // without evidence: the layer is reported as not checked
    if (ev === 'NONE') return 'HISTORICAL_COVERAGE_UNKNOWN'; // the record says nothing about the layer
    if (INVALID.has(ev)) return 'HISTORICAL_COVERAGE_UNKNOWN'; // the gate would have rejected it
    if (VALID_HIT.has(ev)) return 'HISTORICAL_COVERAGE_UNKNOWN'; // the rule engine fires on every hit
  }
  if (record.document === 'FINDING_NO_REFS') return 'HISTORICAL_COVERAGE_UNKNOWN';
  return 'DETERMINED';
}

function expectedCompleted(record: StoredRecord): number {
  let completed = 0;
  for (const layer of LAYERS) {
    const { evidence: ev, finding } = record.layers[layer];
    const risk = finding === 'HIGH' || finding === 'MEDIUM' || finding === 'LOW' || finding === 'HIGH_NC';
    if (risk) completed += 1;
    else if (finding !== 'NC' && (VALID_HIT.has(ev) || VALID_NO_HIT.has(ev))) completed += 1;
  }
  return completed + (record.document === 'PINNED_WITH_FINDING' || record.document === 'PINNED_NO_FINDING' ? 1 : 0);
}

async function readStored(record: StoredRecord) {
  const store = new Map<string, unknown>();
  const failing = new Set<string>();
  const refs: { artifact_id: string; artifact_type: string }[] = [];
  const findings: AssessmentFinding[] = [];
  for (const layer of LAYERS) {
    const { evidence: state, finding } = record.layers[layer];
    let cited: { artifact_id: string; artifact_type: string }[] = [];
    if (state !== 'NONE') {
      const ev = evidence(layer, state);
      refs.push(ref(ev));
      cited = [ref(ev)];
      if (state === 'UNREADABLE_READ_ERROR') {
        store.set(ev.artifact_id, ev);
        failing.add(ev.artifact_id);
      } else if (state !== 'UNREADABLE_NOT_FOUND') {
        store.set(ev.artifact_id, ev);
      }
    }
    const levels = finding === 'HIGH_NC' ? ['HIGH', 'NOT_CHECKED'] : finding === 'NC' ? ['NOT_CHECKED'] : finding === 'NONE' ? [] : [finding];
    for (const level of levels) {
      findings.push({
        finding_id: level === 'NOT_CHECKED' ? `finding-notchecked-${layer}` : `finding-${layer}-${level}`,
        rule_id: RULE[layer], rule_version: '2.0', risk_level: level as AssessmentFinding['risk_level'],
        explanation: 'x', evidence_refs: level === 'NOT_CHECKED' ? [] : cited,
      });
    }
  }
  const document = documentPart(record.document);
  refs.push(...document.refs);
  findings.push(...document.findings);
  if (record.document === 'PINNED_WITH_FINDING' || record.document === 'PINNED_NO_FINDING') {
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

async function assertStored(record: StoredRecord) {
  const label = `stored ${LAYERS.map((l) => `${l}=${record.layers[l].evidence}/${record.layers[l].finding}`).join(' ')} doc=${record.document} other=${record.otherRule}`;
  const { details, statement, findings } = await readStored(record);
  const rows = details.governedLayerChecks;
  const expected = expectedCoverageState(record);
  expect(statement.coverage_state, label).toBe(expected);
  expect(statement.risk_level, label).toBe(machineRisk(findings));

  if (expected === 'DETERMINED') {
    expect(statement.coverage?.checks_completed, label).toBe(expectedCompleted(record));
  } else {
    // (2)/(3): no count is presented -- not in the machine value, not in the text.
    expect(statement.coverage, label).toBeNull();
    expect(statement.statement_sv, label).not.toMatch(COUNT_PATTERN);
    expect(statement.statement_sv, label).not.toMatch(/Ingen samlad risknivå kan presenteras/);
  }
  if (expected === 'HISTORICAL_COVERAGE_UNKNOWN') {
    expect(statement.statement_sv.startsWith(HISTORICAL_SV), label).toBe(true);
  }
  if (expected === 'RECORD_INTEGRITY_ERROR') {
    expect(statement.statement_sv.startsWith('Integritetsfel: '), label).toBe(true);
  }
  if (expected === 'PINNED_EVIDENCE_UNREADABLE') {
    // (3) unreadable pinned evidence is never "no hit": a technical error, overall and per layer.
    expect(statement.statement_sv.startsWith('Den pinnade evidensen kan inte verifieras: '), label).toBe(true);
    const lasting =
      LAYERS.some((l) => record.layers[l].evidence === 'UNREADABLE_NOT_FOUND') || record.document === 'UNREADABLE_WITH_FINDING';
    expect(statement.pinned_evidence?.retryable, label).toBe(!lasting);
    expect(statement.pinned_evidence?.technical_error_class, label).toBe(lasting ? 'EVIDENCE_NOT_FOUND' : 'EVIDENCE_READ_ERROR');
    for (const layer of LAYERS) {
      if (!UNREADABLE.has(record.layers[layer].evidence)) continue;
      const row = rows.find((r) => r.layer === layer)!;
      expect(row.status === 'CHECKED_NO_HIT' || row.message_sv.includes('Ingen registrerad träff'), `${label}: ${layer}`).toBe(false);
      const finding = record.layers[layer].finding;
      if (finding !== 'NC') expect(row.coverage_state, `${label}: ${layer}`).toBe('TECHNICAL_ERROR');
    }
  }
  // Never "no hit" without readable, valid negative evidence behind it.
  for (const layer of LAYERS) {
    const row = rows.find((r) => r.layer === layer)!;
    if (row.status === 'CHECKED_NO_HIT') expect(VALID_NO_HIT.has(record.layers[layer].evidence), `${label}: ${layer}`).toBe(true);
    // The evidence details read each stored result through the same normal form: an evidence
    // outside it is "ofullständigt underlag", never a hit or a no-hit.
    const ev = record.layers[layer].evidence;
    if (INVALID.has(ev)) {
      const detail = details.evidenceDetails.find((d) => d.evidence_artifact_id === evidence(layer, ev).artifact_id)!;
      expect(detail.message_sv, `${label}: ${layer} detail`).toMatch(/^Ofullständigt underlag: /);
    }
  }
  assertKnownRiskNamed(label, statement, rows, findings);
}

function layersWith(background: LayerRecord, target: Layer, state: LayerRecord): Record<Layer, LayerRecord> {
  return Object.fromEntries(LAYERS.map((l) => [l, l === target ? state : background])) as Record<Layer, LayerRecord>;
}

describe('U20CDF2 invariant C: stored records read back -- (1) risk never disappears, (2) historical never 0, (3) unreadable never "no hit"', () => {
  const BACKGROUNDS: Record<string, LayerRecord> = {
    current: { evidence: 'NO_HIT', finding: 'NONE' },
    notChecked: { evidence: 'NONE', finding: 'NC' },
    silent: { evidence: 'NONE', finding: 'NONE' },
  };

  it(`every per-layer state (${EVIDENCE_STATES.length} evidence x ${FINDING_STATES.length} findings) on every layer x 3 backgrounds x ${DOCUMENT_STATES.length} document states`, async () => {
    let checked = 0;
    for (const [, background] of Object.entries(BACKGROUNDS)) {
      for (const target of LAYERS) {
        for (const ev of EVIDENCE_STATES) {
          for (const finding of FINDING_STATES) {
            for (const document of DOCUMENT_STATES) {
              await assertStored({ layers: layersWith(background, target, { evidence: ev, finding }), document, otherRule: false });
              checked += 1;
            }
          }
        }
      }
    }
    expect(checked).toBe(3 * LAYERS.length * EVIDENCE_STATES.length * FINDING_STATES.length * DOCUMENT_STATES.length);
  }, 120_000);

  it('2,000 seeded random records over all five layers at once (plus a stored finding of a rule outside the M checks)', async () => {
    // mulberry32, fixed seed: deterministic.
    let seed = 0x20cdf2;
    const random = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const pick = <T,>(values: readonly T[]) => values[Math.floor(random() * values.length)]!;
    // Half of the layer draws come from the states a current run records, so that whole-record
    // current (DETERMINED) combinations are reached often enough to be tested, not only by chance.
    const CURRENT_LAYER_STATES: readonly LayerRecord[] = [
      { evidence: 'NO_HIT', finding: 'NONE' }, { evidence: 'NO_HIT_NOCOUNT', finding: 'NONE' },
      { evidence: 'HIT', finding: 'HIGH' }, { evidence: 'HIT_NOCOUNT', finding: 'MEDIUM' }, { evidence: 'HIT_CAP', finding: 'LOW' },
      { evidence: 'NONE', finding: 'NC' },
    ];
    const drawLayer = (): LayerRecord => (random() < 0.5 ? pick(CURRENT_LAYER_STATES) : { evidence: pick(EVIDENCE_STATES), finding: pick(FINDING_STATES) });
    const seen = new Set<string>();
    for (let n = 0; n < 2000; n += 1) {
      const layers = Object.fromEntries(LAYERS.map((l) => [l, drawLayer()])) as Record<Layer, LayerRecord>;
      const record = { layers, document: pick(DOCUMENT_STATES), otherRule: random() < 0.3 };
      seen.add(expectedCoverageState(record));
      await assertStored(record);
    }
    // The sample reaches every state.
    expect([...seen].sort()).toEqual(['DETERMINED', 'HISTORICAL_COVERAGE_UNKNOWN', 'PINNED_EVIDENCE_UNREADABLE', 'RECORD_INTEGRITY_ERROR']);
  }, 120_000);
});
