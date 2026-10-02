/**
 * U20CDF3 (U20CDF2 verification H4/H5; owner's locked specification 2026-10-02 night: "ogiltig
 * kombination fail-closed", one common normal form) -- stored records that no known producer writes
 * are a typed integrity error (coverage_state RECORD_INTEGRITY_ERROR), never a count, never an extra
 * row, and a known risk is still named.
 *
 * Read through the REAL read path: resolveGovernedAssessmentDetails over an in-memory CAS, then
 * governedOverallStatement -- the same calls the read-back, HTTP and PDF make.
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
const PROPERTY_REF = { artifact_id: 'lu-property-context-integrity', artifact_type: 'LU_PROPERTY_CONTEXT' } as const;
const LOCATION_REF = { artifact_id: 'localization-geometry-integrity', artifact_type: 'localization_geometry' } as const;
const COUNT_PATTERN = /\b\d+ av \d+ kontroller/;
const INTEGRITY_SV = 'Integritetsfel: bedömningens lagrade underlag är motsägelsefullt eller ligger utanför det styrda formatet.';

/** Content-addressed evidence as the provider builds it; `dataset` may be any string. */
function spatialEvidence(dataset: string, exists: boolean) {
  const payload = {
    result_semantics: {
      kind: 'EXISTENCE_WITHIN_DISTANCE',
      query: { subject_ref: PROPERTY_REF, srid: 3006, distance_meters: 500 },
      result: { exists, match_count_observed: exists ? 2 : 0, max_features_per_layer: 50 },
    },
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
    artifact_id: `evidence-${dataset.trim() || 'blank'}-${content_hash.value.slice(0, 16)}`,
    artifact_type: 'SPATIAL_EVIDENCE' as const,
    content_hash,
    references: [PROPERTY_REF],
    payload,
  };
}

const ref = (a: { artifact_id: string; artifact_type: string }) => ({ artifact_id: a.artifact_id, artifact_type: a.artifact_type });

async function readBack(evidence: readonly ReturnType<typeof spatialEvidence>[], findings: readonly AssessmentFinding[]) {
  const store = new Map<string, unknown>(evidence.map((e) => [e.artifact_id, e]));
  const repository = {
    async resolve<T>(r: { artifact_id: string }): Promise<T> {
      const value = store.get(r.artifact_id);
      if (!value) throw new Error(`Artifact not found: ${r.artifact_id}`);
      return structuredClone(value) as T;
    },
  };
  const details = await resolveGovernedAssessmentDetails({
    assessment: { payload: { findings, evidence_refs: evidence.map(ref) } } as never,
    artifactRepository: repository as never,
  });
  expect(details.integrity).toEqual({ ok: true });
  const riskLevel = findings.some((f) => f.risk_level === 'HIGH') ? 'HIGH' : findings.some((f) => f.risk_level === 'MEDIUM') ? 'MEDIUM' : 'LOW';
  const statement = governedOverallStatement(riskLevel, details.governedLayerChecks, { findings, pinnedEvidence: details.pinnedEvidence });
  return { details, statement };
}

const NEGATIVES = LAYERS.map((layer) => spatialEvidence(layer, false));

describe('U20CDF3 (low 2): stored evidence for a layer outside the governed M is a typed integrity error, never a seventh row', () => {
  it.each<[string, string, boolean]>([
    ['an unknown layer with a hit (verifier probe: flood, exists:true)', 'flood', true],
    ['a mis-cased governed layer with a hit (WATER)', 'WATER', true],
    ['an unknown layer without a hit', 'flood', false],
    ['the document check name as a spatial dataset', 'document', true],
  ])('%s', async (_label, dataset, exists) => {
    const outside = spatialEvidence(dataset, exists);
    const { details, statement } = await readBack([...NEGATIVES, outside], []);

    // Exactly the M checks: five spatial layers + the document check -- no extra row.
    expect(details.governedLayerChecks.map((check) => check.layer)).toEqual([...LAYERS, 'document']);
    expect(statement.coverage_state).toBe('RECORD_INTEGRITY_ERROR');
    expect(statement.coverage_basis).toEqual([`EVIDENCE_OUTSIDE_GOVERNED_LAYERS:${outside.artifact_id}`]);
    expect(statement.coverage).toBeNull();
    expect(statement.statement_sv).toBe(`${INTEGRITY_SV} Täckningsgrad och samlad risknivå kan därför inte fastställas.`);
    expect(statement.statement_sv).not.toMatch(COUNT_PATTERN);
    expect(statement.statement_sv).not.toMatch(/låg risk|6 av 7/i);
    expect(statement).not.toHaveProperty('pinned_evidence');

    // The evidence detail does not present an ungoverned layer as a register result.
    const detail = details.evidenceDetails.find((d) => d.evidence_artifact_id === outside.artifact_id)!;
    expect(detail.message_sv).toBe(
      'Integritetsfel: evidensen gäller ett lager utanför de styrda kontrollerna och tolkas inte som ett kontrollresultat.',
    );
  });

  it('a stored risk finding is still named next to the integrity error (a known risk never disappears)', async () => {
    const hit = spatialEvidence('ebh', true);
    const evidence = [...NEGATIVES.filter((e) => e.payload.source_metadata.dataset !== 'ebh'), hit, spatialEvidence('flood', true)];
    const findings: AssessmentFinding[] = [
      { finding_id: 'finding-ebh-high', rule_id: RULE.ebh!, rule_version: '2.0', risk_level: 'HIGH', explanation: 'x', evidence_refs: [ref(hit)] },
    ];
    const { statement } = await readBack(evidence, findings);
    expect(statement.coverage_state).toBe('RECORD_INTEGRITY_ERROR');
    expect(statement.statement_sv).toBe(
      `${INTEGRITY_SV} Täckningsgrad och samlad risknivå kan därför inte fastställas. ` +
        'Bedömningens lagrade fynd redovisas var för sig: risknivå hög – Potentiellt förorenade områden (EBH).',
    );
  });

  it('the same record without the outside evidence is DETERMINED (control)', async () => {
    const { statement } = await readBack(NEGATIVES, []);
    expect(statement.coverage_state).toBe('DETERMINED');
    expect(statement.coverage?.checks_completed).toBe(5);
  });
});

const notChecked = (layer: string): AssessmentFinding => ({
  finding_id: `finding-notchecked-${layer}`, rule_id: RULE[layer]!, rule_version: '2.0', risk_level: 'NOT_CHECKED',
  explanation: 'x', evidence_refs: [],
});

describe('U20CDF3 (U20CDF2 verification H5.1 / low 4): a NOT_CHECKED finding next to stored evidence for the same layer is an invalid combination, never "0 av M"', () => {
  it('the verifier probe S5: NOT_CHECKED on every layer plus readable negative evidence on every layer -> RECORD_INTEGRITY_ERROR', async () => {
    const { details, statement } = await readBack(NEGATIVES, LAYERS.map(notChecked));
    expect(statement.coverage_state).toBe('RECORD_INTEGRITY_ERROR');
    expect(statement.coverage_basis).toEqual(LAYERS.map((layer) => `NOT_CHECKED_FINDING_WITH_EVIDENCE:${layer}`));
    expect(statement.coverage).toBeNull();
    expect(statement.statement_sv).toBe(`${INTEGRITY_SV} Täckningsgrad och samlad risknivå kan därför inte fastställas.`);
    expect(statement.statement_sv).not.toMatch(/\b0 av \d|Ingen samlad risknivå kan presenteras|låg risk/i);
    // Per layer: still not checked (the NOT_CHECKED finding is never overruled into a no-hit), but as
    // an integrity error pointing at the contradicting evidence -- never "Ingen registrerad träff".
    for (const [index, layer] of LAYERS.entries()) {
      const row = details.governedLayerChecks.find((check) => check.layer === layer)!;
      expect(row).toMatchObject({
        status: 'NOT_CHECKED', reason: 'NOT_CHECKED_FINDING_WITH_EVIDENCE',
        evidence_artifact_id: NEGATIVES[index]!.artifact_id, coverage_state: 'TECHNICAL_ERROR',
      });
      expect(row.message_sv).toMatch(/^Integritetsfel: bedömningen innehåller både ett fynd om att .+ inte kunde kontrolleras och evidens för lagret\. Ingen slutsats om lagret\.$/);
    }
  });

  it('on a single layer, the rest current -> RECORD_INTEGRITY_ERROR naming that layer', async () => {
    const { statement } = await readBack(NEGATIVES, [notChecked('natura2000')]);
    expect(statement.coverage_state).toBe('RECORD_INTEGRITY_ERROR');
    expect(statement.coverage_basis).toEqual(['NOT_CHECKED_FINDING_WITH_EVIDENCE:natura2000']);
    expect(statement.statement_sv).not.toMatch(/\b\d+ av \d+ kontroller/);
  });

  it('with a hit, a stored risk finding AND a NOT_CHECKED finding for the layer -> RECORD_INTEGRITY_ERROR, the risk still named', async () => {
    const hit = spatialEvidence('water', true);
    const evidence = [hit, ...NEGATIVES.filter((e) => e.payload.source_metadata.dataset !== 'water')];
    const findings: AssessmentFinding[] = [
      { finding_id: 'finding-water-medium', rule_id: RULE.water!, rule_version: '2.0', risk_level: 'MEDIUM', explanation: 'x', evidence_refs: [ref(hit)] },
      notChecked('water'),
    ];
    const { details, statement } = await readBack(evidence, findings);
    expect(statement.coverage_state).toBe('RECORD_INTEGRITY_ERROR');
    expect(statement.coverage_basis).toEqual(['NOT_CHECKED_FINDING_WITH_EVIDENCE:water']);
    expect(statement.statement_sv).toContain('Bedömningens lagrade fynd redovisas var för sig: risknivå måttlig – Brunnar.');
    // A layer with a stored risk finding stays completed (owner invariant).
    expect(details.governedLayerChecks[0]).toMatchObject({ layer: 'water', status: 'CHECKED_HIT' });
  });

  it('a NOT_CHECKED finding WITHOUT evidence for the layer is the current form -> DETERMINED (control)', async () => {
    const evidence = NEGATIVES.filter((e) => e.payload.source_metadata.dataset !== 'ebh');
    const { details, statement } = await readBack(evidence, [notChecked('ebh')]);
    expect(statement.coverage_state).toBe('DETERMINED');
    expect(statement.coverage?.checks_completed).toBe(4);
    expect(details.governedLayerChecks[1]).toMatchObject({ layer: 'ebh', status: 'NOT_CHECKED', reason: 'NOT_CHECKED_FINDING', evidence_artifact_id: null });
  });
});
