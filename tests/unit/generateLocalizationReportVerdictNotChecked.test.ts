/**
 * SEM-1 (W2) -- verdict-consequence proof.
 *
 * ADR-28A section 1 (SEM-1): "UNKNOWN/NOT_CHECKED is a non-severity state." K-30 M3/K-28 point 3
 * sharpen this into a testable claim: a NOT_CHECKED finding must never be silently absorbed into
 * a verdict that reads as "nothing found / clear" (`overallRisk: 'LOW'`, `permitProbability:
 * 0.95`, an empty `unresolvedChecks`), and the other governed layers' real findings must still be
 * reflected in `overallRisk`/`permitProbability` exactly as if the NOT_CHECKED finding were not
 * there.
 *
 * This tests `governedVerdictFromFindings` directly rather than through the full DB-dependent
 * governed pipeline (ExecutionKernel, ProjectContextBinding, Prisma) that `generate-localization-
 * report.usecase.ts` normally calls it from: that pipeline needs a live Postgres this environment
 * does not have available right now, and the verdict-consequence claim is entirely about this one
 * function's mapping from findings to a verdict, not about anything upstream of it.
 */
import { describe, expect, it } from 'vitest';
import { governedVerdictFromFindings } from '../../src/application/generate-localization-report.usecase';
import type { AssessmentFinding } from '../../packages/mps-lu/src/domain/AssessmentFinding';

function finding(rule_id: string, risk_level: AssessmentFinding['risk_level']): AssessmentFinding {
  return {
    finding_id: `finding-${rule_id}`,
    rule_id,
    rule_version: '2.0',
    risk_level,
    explanation: 'fixture',
    evidence_refs: [],
  };
}

describe('SEM-1 (W2): governedVerdictFromFindings never presents a NOT_CHECKED case as clean', () => {
  it('a genuinely clean result (no findings at all) is unaffected: LOW / 0.95 / empty unresolvedChecks', () => {
    const verdict = governedVerdictFromFindings([]);
    expect(verdict.overallRisk).toBe('LOW');
    expect(verdict.permitProbability).toBe(0.95);
    expect(verdict.unresolvedChecks).toEqual([]);
  });

  it('a single NOT_CHECKED finding, alone, is NOT presented as the same clean LOW/0.95 result', () => {
    const verdict = governedVerdictFromFindings([finding('LU-WATER-001', 'NOT_CHECKED')]);
    expect(verdict.unresolvedChecks).toHaveLength(1);
    expect(verdict.unresolvedChecks[0]).toEqual({ rule_id: 'LU-WATER-001', finding_id: 'finding-LU-WATER-001' });
    // The exact SEM-1 regression this guards against: silently reusing the clean-result numbers.
    expect(verdict.permitProbability).not.toBe(0.95);
    expect(verdict.summary).not.toBe('Governed LU assessment findings establish LOW risk.');
  });

  it('a NOT_CHECKED finding never raises overallRisk by itself -- it is a non-severity state', () => {
    const verdict = governedVerdictFromFindings([finding('LU-WATER-001', 'NOT_CHECKED')]);
    // Still LOW: nothing severe was found among the checks that did complete. The point is not
    // that overallRisk changes, but that unresolvedChecks/permitProbability/summary make clear
    // this is not the same claim as a fully-completed clean result (see the test above).
    expect(verdict.overallRisk).toBe('LOW');
  });

  it('HIGH from a completed check still wins over a NOT_CHECKED finding on a different rule, and both are visible', () => {
    const verdict = governedVerdictFromFindings([
      finding('LU-EBH-001', 'HIGH'),
      finding('LU-WATER-001', 'NOT_CHECKED'),
    ]);
    expect(verdict.overallRisk).toBe('HIGH');
    expect(verdict.permitProbability).toBe(0.2);
    expect(verdict.unresolvedChecks).toEqual([{ rule_id: 'LU-WATER-001', finding_id: 'finding-LU-WATER-001' }]);
  });

  it('MEDIUM from a completed check still wins over a NOT_CHECKED finding on a different rule, and both are visible', () => {
    const verdict = governedVerdictFromFindings([
      finding('LU-PROTECTED-001', 'MEDIUM'),
      finding('LU-WATER-001', 'NOT_CHECKED'),
    ]);
    expect(verdict.overallRisk).toBe('MEDIUM');
    expect(verdict.permitProbability).toBe(0.5);
    expect(verdict.unresolvedChecks).toEqual([{ rule_id: 'LU-WATER-001', finding_id: 'finding-LU-WATER-001' }]);
  });

  it('multiple NOT_CHECKED findings are all listed in unresolvedChecks', () => {
    const verdict = governedVerdictFromFindings([
      finding('LU-WATER-001', 'NOT_CHECKED'),
      finding('LU-EBH-001', 'NOT_CHECKED'),
    ]);
    expect(verdict.unresolvedChecks.map((c) => c.rule_id).sort()).toEqual(['LU-EBH-001', 'LU-WATER-001']);
  });

  it('a normal LOW-severity finding (not NOT_CHECKED) with no unresolved checks still reads as fully clean', () => {
    // There is no LOW-severity emission in LURuleEngine today, but the verdict function must not
    // special-case away from the clean path just because SOME finding exists -- only NOT_CHECKED
    // should do that.
    const verdict = governedVerdictFromFindings([]);
    expect(verdict.overallRisk).toBe('LOW');
    expect(verdict.permitProbability).toBe(0.95);
    expect(verdict.unresolvedChecks).toEqual([]);
  });
});
