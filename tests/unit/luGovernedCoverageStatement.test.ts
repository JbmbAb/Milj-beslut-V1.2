/**
 * U20CDF -- the coverage-qualified overall statement (governedCoverageStatement.ts), pure.
 *
 *  - F2 (owner wording): 0 of M completed -> no risk level is named at all.
 *  - F6: all M completed -> the statement says how many of them rest on a basis known to be limited
 *    (a dataset with known coverage gaps, or the v1 document check), never a bare "6 av 6".
 *  - The owner form for 1 <= N < M (OD-K0-1) is unchanged.
 *
 * U20CDF2 (U20CDF verification G1; owner's locked specification 2026-10-02 night):
 *  - a record without sufficient coverage metadata (a governed layer it says nothing about, a stored
 *    risk finding without the consistent evidence a current run pins, ...) never reads "0 av M":
 *    coverage_state HISTORICAL_COVERAGE_UNKNOWN, "Täckningsgrad kan inte fastställas för denna
 *    historiska bedömning.", and the stored findings are named in full, never toned down;
 *  - a known risk never disappears from the overall text (also at 0 of M);
 *  - the "unknown coverage" branch no longer starts with "Låg risk".
 * The statement now takes the assessment's stored findings (the rule engine's outcome) as context:
 * coverage and risk come from the same record.
 */
import { describe, expect, it } from 'vitest';
import {
  assessGovernedCoverage,
  governedOverallStatementSv,
  summarizeGovernedCheckCoverage,
} from '../../server/modules/localization/governedCoverageStatement';

const GAP = { gap_id: 'X', kind: 'CONTRACT_SCOPE' };
const row = (layer: string, status: string, gaps: unknown[] = [], extra: Record<string, unknown> = {}) => ({
  layer, rule_id: null, status, evidence_artifact_id: null, reason: null, known_coverage_gaps: gaps, ...extra,
});
const NO_FINDINGS = { findings: [] };
const HISTORICAL_SV = 'Täckningsgrad kan inte fastställas för denna historiska bedömning.';

const COMPLETE = [
  row('water', 'CHECKED_HIT'),
  row('ebh', 'CHECKED_NO_HIT'),
  row('protected_area', 'CHECKED_NO_HIT', [GAP]),
  row('natura2000', 'CHECKED_HIT', [GAP, GAP]),
  row('water_protection_area', 'CHECKED_NO_HIT', [GAP]),
  row('document', 'CHECKED_HIT'),
];

describe('U20CDF: governedOverallStatementSv', () => {
  it('F6: all checks completed -> "varav K med begränsad täckning" (datasets with known gaps + the v1 document check)', () => {
    expect(governedOverallStatementSv('LOW', COMPLETE, NO_FINDINGS)).toBe(
      'Låg risk i de kontroller som utfördes; 6 av 6 kontroller genomförda, varav 4 med begränsad täckning.',
    );
    expect(summarizeGovernedCheckCoverage(COMPLETE)).toEqual({
      checks_total: 6,
      checks_completed: 6,
      checks_not_completed: 0,
      not_completed_layers: [],
      checks_completed_with_limited_coverage: 4,
      limited_coverage_layers: ['protected_area', 'natura2000', 'water_protection_area', 'document'],
    });
  });

  it('F6: all checks completed and none limited -> no clause', () => {
    const checks = [row('water', 'CHECKED_HIT'), row('ebh', 'CHECKED_NO_HIT')];
    expect(governedOverallStatementSv('MEDIUM', checks, NO_FINDINGS)).toBe('Måttlig risk i de kontroller som utfördes; 2 av 2 kontroller genomförda.');
  });

  it('a limited layer whose check did NOT complete is not counted as limited-and-completed', () => {
    const checks = [row('water', 'CHECKED_HIT'), row('natura2000', 'NOT_CHECKED', [GAP])];
    expect(summarizeGovernedCheckCoverage(checks)).toMatchObject({ checks_completed_with_limited_coverage: 0, limited_coverage_layers: [] });
  });

  it('OD-K0-1: the owner form for 1 <= N < M is unchanged', () => {
    const checks = [...COMPLETE.slice(0, 5), row('document', 'NOT_CHECKED')];
    expect(governedOverallStatementSv('HIGH', checks, NO_FINDINGS)).toBe(
      'Hög risk i de kontroller som utfördes; underlaget är ofullständigt: 5 av 6 kontroller genomförda.',
    );
  });

  it('F2 (owner wording): 0 of M -> no risk level, the word "låg risk" never occurs', () => {
    const none = COMPLETE.map((c) => ({ ...c, status: 'NOT_CHECKED' }));
    for (const level of ['LOW', 'MEDIUM', 'HIGH']) {
      const text = governedOverallStatementSv(level, none, NO_FINDINGS);
      expect(text).toBe('Ingen samlad risknivå kan presenteras – 0 av 6 kontroller genomförda.');
      expect(text).not.toMatch(/låg risk|måttlig risk|hög risk/i);
    }
  });

  it('U20CDF2 (LOW 2): unknown coverage (no checks at all) names no risk level -- never "Låg risk"', () => {
    for (const checks of [undefined, null, []]) {
      const text = governedOverallStatementSv('LOW', checks, NO_FINDINGS);
      expect(text).toBe('Täckningsgrad kan inte fastställas: uppgift om genomförda kontroller saknas i underlaget.');
      expect(text).not.toMatch(/låg risk/i);
      expect(assessGovernedCoverage(checks, NO_FINDINGS)).toMatchObject({ coverage_state: 'CHECKS_UNAVAILABLE', coverage: null });
    }
  });
});

describe('U20CDF2 (G1): coverage that cannot be established is never "0 av M"; a known risk is never dropped', () => {
  const spatial = (layer: string, rule: string, status: string, reason: string | null) => ({
    layer, rule_id: rule, status, evidence_artifact_id: null, reason, known_coverage_gaps: [],
  });
  const DOC_NOT_CHECKED = { ...row('document', 'NOT_CHECKED'), rule_id: 'LU-DOC-BESLUT-001', reason: 'NO_VERIFIED_DOCUMENT_EVIDENCE_PINNED' };
  // The verifier's probe H1, as rows: an older assessment with no pinned evidence and a stored HIGH ebh finding.
  const H1_CHECKS = [
    spatial('water', 'LU-WATER-001', 'NOT_CHECKED', 'NO_EVIDENCE'),
    spatial('ebh', 'LU-EBH-001', 'CHECKED_HIT', 'FINDING_WITHOUT_CONSISTENT_EVIDENCE'),
    spatial('protected_area', 'LU-PROTECTED-001', 'NOT_CHECKED', 'NO_EVIDENCE'),
    spatial('natura2000', 'LU-NATURA2000-001', 'NOT_CHECKED', 'NO_EVIDENCE'),
    spatial('water_protection_area', 'LU-WATERPROTECTION-001', 'NOT_CHECKED', 'NO_EVIDENCE'),
    DOC_NOT_CHECKED,
  ];
  const H1_FINDINGS = { findings: [{ rule_id: 'LU-EBH-001', risk_level: 'HIGH' }] };

  it('probe H1: HISTORICAL_COVERAGE_UNKNOWN, the owner text, and the stored HIGH finding named in full', () => {
    expect(assessGovernedCoverage(H1_CHECKS, H1_FINDINGS)).toEqual({
      coverage_state: 'HISTORICAL_COVERAGE_UNKNOWN',
      coverage_basis: [
        'LAYER_NOT_RECORDED:water',
        'FINDING_WITHOUT_CONSISTENT_EVIDENCE:ebh',
        'LAYER_NOT_RECORDED:protected_area',
        'LAYER_NOT_RECORDED:natura2000',
        'LAYER_NOT_RECORDED:water_protection_area',
      ],
      coverage: null,
    });
    const text = governedOverallStatementSv('HIGH', H1_CHECKS, H1_FINDINGS);
    expect(text).toBe(
      `${HISTORICAL_SV} Bedömningens lagrade fynd redovisas var för sig: risknivå hög – Potentiellt förorenade områden (EBH).`,
    );
    expect(text).not.toMatch(/\b0 av \d|låg risk|ingen samlad risknivå/i);
  });

  it('an older record with no evidence and no findings: the owner text alone, no count, no level', () => {
    const silent = H1_CHECKS.map((c) => (c.layer === 'ebh' ? spatial('ebh', 'LU-EBH-001', 'NOT_CHECKED', 'NO_EVIDENCE') : c));
    expect(governedOverallStatementSv('LOW', silent, NO_FINDINGS)).toBe(HISTORICAL_SV);
    expect(assessGovernedCoverage(silent, NO_FINDINGS)).toMatchObject({ coverage_state: 'HISTORICAL_COVERAGE_UNKNOWN', coverage: null });
  });

  it.each<[string, (typeof H1_CHECKS)[number][], { findings: { rule_id: string; risk_level: string }[] }, string]>([
    [
      'an uninterpretable evidence result',
      [spatial('water', 'LU-WATER-001', 'NOT_CHECKED', 'UNRECOGNIZED_RESULT')],
      NO_FINDINGS,
      'EVIDENCE_NOT_IN_NORMAL_FORM:water',
    ],
    [
      'a hit no finding accounts for (the rule engine fires on every hit)',
      [spatial('natura2000', 'LU-NATURA2000-001', 'CHECKED_HIT', null)],
      NO_FINDINGS,
      'HIT_WITHOUT_FINDING:natura2000',
    ],
    [
      'a document finding without the pinned document evidence it rests on',
      [{ ...DOC_NOT_CHECKED }],
      { findings: [{ rule_id: 'LU-DOC-BESLUT-001', risk_level: 'MEDIUM' }] },
      'DOCUMENT_FINDING_WITHOUT_PINNED_DOCUMENTS',
    ],
  ])('%s -> HISTORICAL_COVERAGE_UNKNOWN (%s)', (_label, checks, context, basis) => {
    expect(assessGovernedCoverage(checks, context)).toMatchObject({ coverage_state: 'HISTORICAL_COVERAGE_UNKNOWN', coverage_basis: [basis], coverage: null });
    expect(governedOverallStatementSv('MEDIUM', checks, context)).toMatch(/^Täckningsgrad kan inte fastställas för denna historiska bedömning\./);
  });

  it('a current record (every layer accounted for, findings and evidence consistent) is DETERMINED', () => {
    const checks = [
      spatial('water', 'LU-WATER-001', 'CHECKED_HIT', null),
      spatial('ebh', 'LU-EBH-001', 'CHECKED_NO_HIT', null),
      spatial('protected_area', 'LU-PROTECTED-001', 'NOT_CHECKED', 'NOT_CHECKED_FINDING'),
      spatial('natura2000', 'LU-NATURA2000-001', 'CHECKED_NO_HIT', null),
      spatial('water_protection_area', 'LU-WATERPROTECTION-001', 'CHECKED_NO_HIT', null),
      DOC_NOT_CHECKED,
    ];
    const context = { findings: [{ rule_id: 'LU-WATER-001', risk_level: 'MEDIUM' }, { rule_id: 'LU-PROTECTED-001', risk_level: 'NOT_CHECKED' }] };
    expect(assessGovernedCoverage(checks, context)).toMatchObject({ coverage_state: 'DETERMINED', coverage_basis: [], coverage: { checks_completed: 4, checks_total: 6 } });
    expect(governedOverallStatementSv('MEDIUM', checks, context)).toBe(
      'Måttlig risk i de kontroller som utfördes; underlaget är ofullständigt: 4 av 6 kontroller genomförda.',
    );
  });

  it('0 of M with a stored risk finding outside the M checks: the count stands and the finding is named, never dropped', () => {
    const none = [
      spatial('water', 'LU-WATER-001', 'NOT_CHECKED', 'NOT_CHECKED_FINDING'),
      spatial('ebh', 'LU-EBH-001', 'NOT_CHECKED', 'NOT_CHECKED_FINDING'),
      DOC_NOT_CHECKED,
    ];
    const context = { findings: [{ rule_id: 'LU-GOVERNED-001', risk_level: 'MEDIUM' }, { rule_id: 'LU-WATER-001', risk_level: 'NOT_CHECKED' }, { rule_id: 'LU-EBH-001', risk_level: 'NOT_CHECKED' }] };
    const text = governedOverallStatementSv('MEDIUM', none, context);
    expect(text).toBe(
      'Ingen samlad risknivå kan presenteras – 0 av 3 kontroller genomförda. ' +
        'Bedömningens lagrade fynd redovisas var för sig: risknivå måttlig – LU-GOVERNED-001.',
    );
    expect(text).not.toMatch(/låg risk/i);
  });
});
