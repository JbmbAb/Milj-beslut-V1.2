/**
 * Diagnostic cross-check: do the controller's REASONS line up with the adjudicator's reasons?
 *
 * The harness never compares expectedSafetyClass mechanically against blocker codes, and it must
 * not: the facit is an independent hypothesis, not a specification of this implementation, and
 * forcing the two vocabularies to match would quietly turn it into one. But a 122/122 agreement on
 * verdicts with mismatched reasoning would mean the controller reached the right answers for the
 * wrong reasons, and that is worth knowing. This test prints the cross-tabulation and asserts only
 * the two things that would be outright wrong: an expected-safe case that produced blockers, and an
 * expected-blocked case that produced none.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runReplayAcceptance } from './index.js';

const AUTHORITY_ROOT =
  process.env.WLC_AUTHORITY_ROOT ??
  'C:\\Users\\jimmy\\phase0-authority-store\\mirrors\\sha256\\e2eb8fbd111ae0e6efdf2b40e2b746e97b1f708d0f34c6ee45576f852e9b22a6';
const authorityPresent = existsSync(join(AUTHORITY_ROOT, 'corpus', 'capture-manifest-v1.json'));

describe.skipIf(!authorityPresent)('acceptance diagnostics', () => {
  it('cross-tabulates the adjudicator’s safety class against the controller’s blocker codes', async () => {
    const report = await runReplayAcceptance({
      authorityRoot: AUTHORITY_ROOT,
      operation: 'WORKTREE_REMOVAL',
    });

    const byClass = new Map<string, Map<string, number>>();
    for (const c of report.cases) {
      const key = c.expectedSafetyClass;
      const codes = c.blockerCodes.length === 0 ? ['<none: SAFE_TO_REMOVE>'] : [...c.blockerCodes].sort();
      const signature = codes.join(' + ');
      const inner = byClass.get(key) ?? new Map<string, number>();
      inner.set(signature, (inner.get(signature) ?? 0) + 1);
      byClass.set(key, inner);
    }

    const lines: string[] = [];
    for (const [safetyClass, inner] of [...byClass].sort()) {
      const total = [...inner.values()].reduce((a, b) => a + b, 0);
      lines.push(`${safetyClass}  (${total})`);
      for (const [signature, count] of [...inner].sort((a, b) => b[1] - a[1])) {
        lines.push(`    ${String(count).padStart(3)}  ${signature}`);
      }
    }

    console.log(`\nexpectedSafetyClass -> controller blocker codes\n\n${lines.join('\n')}\n`);

    const evidenceCounts = new Map<string, number>();
    for (const c of report.cases) {
      for (const e of c.evidence) {
        const head = e.split(' ')[0];
        evidenceCounts.set(head, (evidenceCounts.get(head) ?? 0) + 1);
      }
    }

    console.log(
      `evidence citations: ${[...evidenceCounts].sort().map(([k, v]) => `${k}=${v}`).join(' ')}\n`,
    );

    const safeWithBlockers = report.cases.filter(
      (c) => c.actual === 'SAFE_TO_REMOVE' && c.blockerCodes.length > 0,
    );
    const blockedWithoutBlockers = report.cases.filter(
      (c) => c.actual === 'BLOCKED' && c.blockerCodes.length === 0,
    );
    expect(safeWithBlockers.map((c) => c.caseId)).toEqual([]);
    expect(blockedWithoutBlockers.map((c) => c.caseId)).toEqual([]);

    // Every SAFE_TO_REMOVE must rest on POSITIVE proof, not on the absence of a reason to block
    // (A19). The four predicates below are the ones the adjudicator cites for a proven-safe case,
    // and a safe decision that did not cite them would be an unproven one.
    for (const c of report.cases.filter((x) => x.actual === 'SAFE_TO_REMOVE')) {
      const joined = c.evidence.join(' | ');
      expect(joined, `${c.caseId} lacks status evidence`).toContain('R-W-04');
      expect(joined, `${c.caseId} lacks object-existence evidence`).toContain('R-G-11');
      expect(joined, `${c.caseId} lacks ancestry evidence`).toContain('R-G-12');
      expect(joined, `${c.caseId} lacks unique-commit evidence`).toContain('R-G-15');
    }
  }, 600000);
});
