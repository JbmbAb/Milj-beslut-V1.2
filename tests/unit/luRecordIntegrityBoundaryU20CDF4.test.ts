/**
 * U20CDF4 (owner decisions 2026-10-03 night (4), points 1-2, and the coordinator's binding
 * clarifications; U20CDF3 verification L4-L6) -- the boundary between a stored record that breaks an
 * ACTUAL contract (RECORD_INTEGRITY_ERROR) and one that merely predates metadata older formats never
 * promised (HISTORICAL_COVERAGE_UNKNOWN), read through the REAL read path:
 * resolveGovernedAssessmentDetails over an in-memory CAS, then governedOverallStatement -- the same calls
 * the read-back, the PDF, verify and the map make.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../server/db/prisma', async () => (await import('../helpers/hermeticPrismaGuard')).hermeticPrismaModule());

import { buildSpatialEvidenceContentHash, SPATIAL_STACK_V1, type AssessmentFinding } from '@miljobeslut/mps-lu';
import {
  governedOverallStatement,
  resolveGovernedAssessmentDetails,
} from '../../server/modules/localization/governedEvidenceDetails';
import { hermeticPrismaTouches } from '../helpers/hermeticPrismaGuard';

afterEach(() => {
  expect(hermeticPrismaTouches).toEqual([]);
});

const LAYERS = ['water', 'ebh', 'protected_area', 'natura2000', 'water_protection_area'] as const;
const RULE: Record<string, string> = {
  water: 'LU-WATER-001',
  ebh: 'LU-EBH-001',
  protected_area: 'LU-PROTECTED-001',
  natura2000: 'LU-NATURA2000-001',
  water_protection_area: 'LU-WATERPROTECTION-001',
};
const HASH = '2b4b514f8b18a1a614d9aeac75c32eff8c52a3864c54770be112fd88fa263ddc';
const PROPERTY_REF = { artifact_id: 'lu-property-context-u20cdf4', artifact_type: 'LU_PROPERTY_CONTEXT' } as const;
const LOCATION_REF = { artifact_id: 'localization-geometry-u20cdf4', artifact_type: 'localization_geometry' } as const;
const COUNT_PATTERN = /\b\d+ av \d+ kontroller/;
const INTEGRITY_SV =
  'Integritetsfel: bedömningens lagrade underlag är motsägelsefullt eller ligger utanför det styrda formatet. ' +
  'Täckningsgrad och samlad risknivå kan därför inte fastställas.';
const HISTORICAL_SV = 'Täckningsgrad kan inte fastställas för denna historiska bedömning.';

type Result = Record<string, unknown>;

/** Content-addressed evidence as the provider builds it (V3 query contract); `result` may break the contract. */
function spatialEvidence(dataset: string, result: Result, kind: unknown = 'EXISTENCE_WITHIN_DISTANCE') {
  const payload = {
    result_semantics: { kind, query: { subject_ref: PROPERTY_REF, srid: 3006, distance_meters: 500 }, result },
    property_ref: PROPERTY_REF,
    srid: 3006,
    operation: { algorithm: 'spatial.dwithin_existence', engine: 'PostGIS', engine_fingerprint: SPATIAL_STACK_V1 },
    geometry: null,
    layer_ref: { layer_id: dataset, version_hash: HASH, layer_version: 'v1.0' },
    source_metadata: { provider: 'Provider', dataset, dataset_version: HASH, retrieved_at: '2026-10-02T10:00:00.000Z' },
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
  return {
    artifact_id: `evidence-${dataset}-${content_hash.value.slice(0, 16)}`,
    artifact_type: 'SPATIAL_EVIDENCE' as const,
    content_hash,
    references: [PROPERTY_REF],
    payload,
  };
}
type Evidence = ReturnType<typeof spatialEvidence>;

const NEG = (layer: string) => spatialEvidence(layer, { exists: false, match_count_observed: 0, max_features_per_layer: 50 });
const HIT = (layer: string) => spatialEvidence(layer, { exists: true, match_count_observed: 2, max_features_per_layer: 50 });
const NEGATIVES = LAYERS.map(NEG);
const ref = (a: { artifact_id: string; artifact_type: string }) => ({ artifact_id: a.artifact_id, artifact_type: a.artifact_type });
const without = (layer: string) => NEGATIVES.filter((e) => e.payload.source_metadata.dataset !== layer);

/**
 * Reads a record back. `refs` defaults to the stored evidence's refs; `contractVersion` undefined is a
 * legacy (V1) assessment, as in the U20CDF3 suite.
 */
async function readBack(input: {
  readonly stored: readonly unknown[];
  readonly findings: unknown;
  readonly refs?: unknown;
  readonly contractVersion?: string;
}) {
  const store = new Map<string, unknown>(
    input.stored.map((e) => [(e as { artifact_id: string }).artifact_id, e] as const),
  );
  const repository = {
    async resolve<T>(r: { artifact_id: string }): Promise<T> {
      const value = store.get(r.artifact_id);
      if (!value) throw new Error(`Artifact not found: ${r.artifact_id}`);
      return structuredClone(value) as T;
    },
  };
  const refs = input.refs ?? input.stored.map((e) => ref(e as Evidence));
  const payload = {
    findings: input.findings,
    evidence_refs: refs,
    ...(input.contractVersion ? { assessment_contract_version: input.contractVersion } : {}),
  };
  const details = await resolveGovernedAssessmentDetails({ assessment: { payload } as never, artifactRepository: repository as never });
  const findings = (Array.isArray(input.findings) ? input.findings : []) as AssessmentFinding[];
  const statement = governedOverallStatement('LOW', details.governedLayerChecks, {
    findings: input.findings as never,
    pinnedEvidence: details.pinnedEvidence,
  });
  return { details, statement, findings };
}

const finding = (layer: string, level: unknown, cites: readonly Evidence[] = [], id = `finding-${layer}`): AssessmentFinding =>
  ({ finding_id: id, rule_id: RULE[layer] ?? layer, rule_version: '2.0', risk_level: level, explanation: 'x', evidence_refs: cites.map(ref) }) as never;

describe('U20CDF4 (U20CDF3 verification L4): the same ref pinned twice is named for what it is -- never "mer än en evidens"', () => {
  it('one negative evidence pinned twice -> RECORD_INTEGRITY_ERROR (DUPLICATE_LAYER_EVIDENCE), the row says the SAME evidence is pinned more than once', async () => {
    const water = NEGATIVES[0]!;
    const { details, statement } = await readBack({ stored: NEGATIVES, findings: [], refs: [ref(water), ...NEGATIVES.map(ref)] });
    expect(details.integrity).toEqual({ ok: true });
    expect(statement.coverage_state).toBe('RECORD_INTEGRITY_ERROR');
    expect(statement.coverage_basis).toEqual(['DUPLICATE_LAYER_EVIDENCE:water']);
    const row = details.governedLayerChecks[0]!;
    expect(row).toMatchObject({ layer: 'water', status: 'NOT_CHECKED', reason: 'DUPLICATE_LAYER_EVIDENCE', coverage_state: 'TECHNICAL_ERROR' });
    expect(row.message_sv).toBe('Integritetsfel: bedömningen pinnar samma evidens för Brunnar mer än en gång. Ingen slutsats om lagret.');
    expect(row.message_sv).not.toMatch(/mer än en evidens/);
  });

  it('a hit pinned twice with its stored risk finding -> the layer stays a hit (risk named), the same evidence named as pinned twice', async () => {
    const hit = HIT('water');
    const stored = [hit, ...without('water')];
    const { details, statement } = await readBack({ stored, findings: [finding('water', 'HIGH', [hit])], refs: [ref(hit), ...stored.map(ref)] });
    expect(statement.coverage_state).toBe('RECORD_INTEGRITY_ERROR');
    expect(statement.statement_sv).toContain('risknivå hög – Brunnar');
    expect(details.governedLayerChecks[0]!.message_sv).toBe(
      'Träff enligt bedömningens lagrade fynd för Brunnar (Provider) (risknivå hög). ' +
        'Integritetsfel: bedömningen pinnar samma evidens för Brunnar mer än en gång.',
    );
  });

  it('two DIFFERENT evidences for one layer keep the "mer än en evidens" text (control)', async () => {
    const hit = HIT('water');
    const { details } = await readBack({ stored: [hit, ...NEGATIVES], findings: [] });
    expect(details.governedLayerChecks[0]!.message_sv).toBe('Integritetsfel: bedömningen innehåller mer än en evidens för Brunnar. Ingen slutsats om lagret.');
  });
});

describe('U20CDF4 (owner decision 2): stored evidence that DECLARES the result contract but breaks it is an integrity error, never historical', () => {
  // Every intact SPATIAL_EVIDENCE has carried result_semantics since b2f7ea9b (2026-08-13), and the
  // only kind ever admitted/produced is EXISTENCE_WITHIN_DISTANCE with { exists, match_count_observed,
  // max_features_per_layer }. Evidence that declares that contract and breaks it was never written by a
  // producer: a contract break (RECORD_INTEGRITY_ERROR), not an older format.
  const VIOLATE_SV = 'Integritetsfel: evidensen för Brunnar anger det styrda resultatkontraktet men bryter mot det. Ingen slutsats om lagret.';
  it.each<[string, Result, unknown]>([
    ['exists as a string', { exists: 'true', match_count_observed: 1, max_features_per_layer: 50 }, 'EXISTENCE_WITHIN_DISTANCE'],
    ['a field outside the contract', { exists: false, match_count_observed: 0, max_features_per_layer: 50, note: 'x' }, 'EXISTENCE_WITHIN_DISTANCE'],
    ['a count above the cap', { exists: true, match_count_observed: 99, max_features_per_layer: 50 }, 'EXISTENCE_WITHIN_DISTANCE'],
    ['exists:true with count 0', { exists: true, match_count_observed: 0, max_features_per_layer: 50 }, 'EXISTENCE_WITHIN_DISTANCE'],
    ['exists:false with count 3', { exists: false, match_count_observed: 3, max_features_per_layer: 50 }, 'EXISTENCE_WITHIN_DISTANCE'],
    ['another declared kind', { exists: true, match_count_observed: 1, max_features_per_layer: 50 }, 'FEATURE_GEOMETRY'],
  ])('%s, no finding -> RECORD_INTEGRITY_ERROR (EVIDENCE_VIOLATES_RESULT_CONTRACT); row and evidence detail say so, never a hit or a no-hit', async (_label, result, kind) => {
    const broken = spatialEvidence('water', result, kind);
    const { details, statement } = await readBack({ stored: [broken, ...without('water')], findings: [] });
    expect(details.integrity).toEqual({ ok: true });
    expect(statement.coverage_state).toBe('RECORD_INTEGRITY_ERROR');
    expect(statement.coverage_basis).toEqual(['EVIDENCE_VIOLATES_RESULT_CONTRACT:water']);
    expect(statement.coverage).toBeNull();
    expect(statement.statement_sv).toBe(INTEGRITY_SV);
    expect(statement.statement_sv).not.toMatch(COUNT_PATTERN);
    const row = details.governedLayerChecks[0]!;
    expect(row).toMatchObject({
      layer: 'water', status: 'NOT_CHECKED', reason: 'EVIDENCE_VIOLATES_RESULT_CONTRACT', evidence_artifact_id: broken.artifact_id, coverage_state: 'TECHNICAL_ERROR',
    });
    expect(row.message_sv).toBe(VIOLATE_SV);
    // U20CDF3 verification L5 (mutation X6 survived): the evidence DETAIL of an evidence outside the
    // normal form is pinned too -- it is the integrity text, never a register hit or no-hit read from
    // the raw `exists`.
    const detail = details.evidenceDetails.find((d) => d.evidence_artifact_id === broken.artifact_id)!;
    expect(detail.message_sv).toBe(VIOLATE_SV);
    expect(detail.message_sv).not.toMatch(/Registrerad träff|Ingen registrerad träff/);
  });

  it('next to a stored risk finding: the layer stays a hit (a known risk never disappears), the record is an integrity error', async () => {
    const broken = spatialEvidence('water', { exists: true, match_count_observed: 0, max_features_per_layer: 50 });
    const { details, statement } = await readBack({ stored: [broken, ...without('water')], findings: [finding('water', 'MEDIUM', [broken])] });
    expect(statement.coverage_state).toBe('RECORD_INTEGRITY_ERROR');
    expect(statement.coverage_basis).toEqual(['EVIDENCE_VIOLATES_RESULT_CONTRACT:water']);
    expect(statement.statement_sv).toBe(`${INTEGRITY_SV} Bedömningens lagrade fynd redovisas var för sig: risknivå måttlig – Brunnar.`);
    expect(details.governedLayerChecks[0]).toMatchObject({ layer: 'water', status: 'CHECKED_HIT', reason: 'EVIDENCE_VIOLATES_RESULT_CONTRACT' });
    expect(details.governedLayerChecks[0]!.message_sv).toBe(
      'Träff enligt bedömningens lagrade fynd för Brunnar (Provider) (risknivå måttlig). ' +
        'Integritetsfel: evidensen för Brunnar anger det styrda resultatkontraktet men bryter mot det.',
    );
  });

  it('the same record with a valid negative evidence is DETERMINED (control)', async () => {
    const { statement, details } = await readBack({ stored: NEGATIVES, findings: [] });
    expect(statement.coverage_state).toBe('DETERMINED');
    expect(statement.coverage?.checks_completed).toBe(5);
    expect(details.evidenceDetails[0]!.message_sv).toMatch(/^Ingen registrerad träff i Brunnar \(Provider\) inom 500 m/);
  });
});
