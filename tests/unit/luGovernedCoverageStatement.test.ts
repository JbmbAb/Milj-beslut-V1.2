/**
 * U20CDF -- the coverage-qualified overall statement (governedCoverageStatement.ts), pure.
 *
 *  - F2 (owner wording): 0 of M completed -> no risk level is named at all.
 *  - F6: all M completed -> the statement says how many of them rest on a basis known to be limited
 *    (a dataset with known coverage gaps, or the v1 document check), never a bare "6 av 6".
 *  - The owner form for 1 <= N < M (OD-K0-1) is unchanged.
 */
import { describe, expect, it } from 'vitest';
import {
  governedOverallStatementSv,
  summarizeGovernedCheckCoverage,
} from '../../server/modules/localization/governedCoverageStatement';

const GAP = { gap_id: 'X', kind: 'CONTRACT_SCOPE' };
const row = (layer: string, status: string, gaps: unknown[] = []) => ({
  layer, rule_id: null, status, evidence_artifact_id: null, reason: null, known_coverage_gaps: gaps,
});

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
    expect(governedOverallStatementSv('LOW', COMPLETE)).toBe(
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
    expect(governedOverallStatementSv('MEDIUM', checks)).toBe('Måttlig risk i de kontroller som utfördes; 2 av 2 kontroller genomförda.');
  });

  it('a limited layer whose check did NOT complete is not counted as limited-and-completed', () => {
    const checks = [row('water', 'CHECKED_HIT'), row('natura2000', 'NOT_CHECKED', [GAP])];
    expect(summarizeGovernedCheckCoverage(checks)).toMatchObject({ checks_completed_with_limited_coverage: 0, limited_coverage_layers: [] });
  });

  it('OD-K0-1: the owner form for 1 <= N < M is unchanged', () => {
    const checks = [...COMPLETE.slice(0, 5), row('document', 'NOT_CHECKED')];
    expect(governedOverallStatementSv('HIGH', checks)).toBe(
      'Hög risk i de kontroller som utfördes; underlaget är ofullständigt: 5 av 6 kontroller genomförda.',
    );
  });

  it('F2 (owner wording): 0 of M -> no risk level, the word "låg risk" never occurs', () => {
    const none = COMPLETE.map((c) => ({ ...c, status: 'NOT_CHECKED' }));
    for (const level of ['LOW', 'MEDIUM', 'HIGH']) {
      const text = governedOverallStatementSv(level, none);
      expect(text).toBe('Ingen samlad risknivå kan presenteras – 0 av 6 kontroller genomförda.');
      expect(text).not.toMatch(/låg risk|måttlig risk|hög risk/i);
    }
  });

  it('unknown coverage keeps its own text', () => {
    expect(governedOverallStatementSv('LOW', undefined)).toBe(
      'Låg risk i de kontroller som utfördes; uppgift om antalet genomförda kontroller saknas i underlaget.',
    );
  });
});
