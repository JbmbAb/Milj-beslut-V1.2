/**
 * Test layers 1 and 2, end to end: frozen transcript -> Observer -> snapshot -> Classifier ->
 * disposition -> comparison against the independently frozen expectations.
 *
 * SAFETY is asserted unconditionally. UTILITY is asserted over the frozen utilityRequired subset,
 * and it is the assertion that stops `return BLOCKED` from passing the suite.
 *
 * This run is DIAGNOSTIC. It executes inside the implementer's own worktree and therefore creates no
 * verification authority; the authoritative run happens outside it, against the same bytes fetched
 * by content hash, and prints the same eight digests.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { renderAcceptanceReport, runReplayAcceptance } from './index.js';

const AUTHORITY_ROOT =
  process.env.WLC_AUTHORITY_ROOT ??
  'C:\\Users\\jimmy\\phase0-authority-store\\mirrors\\sha256\\e2eb8fbd111ae0e6efdf2b40e2b746e97b1f708d0f34c6ee45576f852e9b22a6';
const AUTHORITY_REFERENCE =
  process.env.WLC_AUTHORITY_REFERENCE ??
  'C:\\Users\\jimmy\\phase0-authority-store\\authority-references\\phase0-authority-reference-v1.sha256-96e784e7683aa7815ecad807fe43d7ee11bf11ad5a31c5a407c575cedc090f84.json';

const authorityPresent = existsSync(join(AUTHORITY_ROOT, 'corpus', 'capture-manifest-v1.json'));

describe.skipIf(!authorityPresent)('replay acceptance over the frozen corpus', () => {
  it('satisfies SAFETY unconditionally and UTILITY over the frozen subset', async () => {
    const report = await runReplayAcceptance({
      authorityRoot: AUTHORITY_ROOT,
      authorityReferencePath: existsSync(AUTHORITY_REFERENCE) ? AUTHORITY_REFERENCE : undefined,
      operation: 'WORKTREE_REMOVAL',
    });


    console.log(`\n${renderAcceptanceReport(report)}\n`);

    if (report.totals.HARD_FAILURE > 0) {

      console.error(
        report.cases
          .filter((c) => c.outcome === 'HARD_FAILURE')
          .slice(0, 20)
          .map(
            (c) =>
              `  ${c.caseId} expected ${c.expected} (${c.expectedSafetyClass}) got ${c.actual} blockers=[${c.blockerCodes.join(',')}]`,
          )
          .join('\n'),
      );
    }
    if (report.totals.ERROR > 0) {

      console.error(
        report.cases
          .filter((c) => c.outcome === 'ERROR')
          .slice(0, 10)
          .map((c) => `  ${c.caseId} ${String(c.error)}`)
          .join('\n'),
      );
    }

    expect(report.corpus.caseCount).toBe(122);
    expect(report.totals.ERROR).toBe(0);
    expect(report.totals.CORPUS_DRIFT).toBe(0);
    expect(report.safety.falseSafeCaseIds).toEqual([]);
    expect(report.safety.satisfied).toBe(true);
    expect(report.utility.requiredCaseIds).toHaveLength(7);
    expect(report.utility.missedCaseIds).toEqual([]);
    expect(report.utility.satisfied).toBe(true);
    expect(report.totals.HARD_FAILURE).toBe(0);

    // The report must always be able to say what it did NOT prove. A corpus with no timeout and no
    // spawn failure cannot exercise the fail-closed path, and a report that stayed silent about that
    // would invite the reader to believe the opposite.
    expect(report.unexercised.length).toBeGreaterThan(0);
  }, 600000);
});
