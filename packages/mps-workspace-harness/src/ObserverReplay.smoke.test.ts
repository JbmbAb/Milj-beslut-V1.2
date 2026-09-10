/**
 * Diagnostic: run the V1 request sequencer against the frozen corpus and report transport refusals.
 *
 * This is the test that decides whether the Observer's implementation of the frozen order of
 * execution, the candidate expansion and the shaSet rule actually reproduces what Phase 0 recorded.
 * Any divergence surfaces as NOT_IN_CORPUS, NOT_CAPTURED_BY_PRECONDITION or
 * REQUEST_OUTSIDE_COMMAND_SURFACE rather than as a plausible wrong answer, which is the property
 * the whole replay contract exists to provide.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { RequestSequencer } from '@miljobeslut/mps-workspace-observer';

import { ReplayTransport, loadCorpus } from './index.js';

const AUTHORITY_ROOT =
  process.env.WLC_AUTHORITY_ROOT ??
  'C:\\Users\\jimmy\\phase0-authority-store\\mirrors\\sha256\\e2eb8fbd111ae0e6efdf2b40e2b746e97b1f708d0f34c6ee45576f852e9b22a6';
const SURFACE_DIGEST = 'd1213675fcf2b945ea74a189eac7ede88ebf4474402b591e5730728698b6f642';
const authorityPresent = existsSync(join(AUTHORITY_ROOT, 'corpus', 'capture-manifest-v1.json'));

describe.skipIf(!authorityPresent)('observer replay over the frozen corpus', () => {
  const corpus = loadCorpus({
    corpusDir: join(AUTHORITY_ROOT, 'corpus'),
    commandSurfacePath: join(
      AUTHORITY_ROOT,
      'contracts',
      'workspace-observer-command-surface-v1.json',
    ),
    commandSurfaceDigest: SURFACE_DIGEST,
  });

  it('replays every one of the 122 frozen cases without a transport refusal', async () => {
    const failures: { caseId: string; code?: string; message: string }[] = [];
    const stats: { caseId: string; discovered: boolean; observed: number; unknown: number; notAttempted: number }[] = [];

    for (const caseId of [...corpus.cases.keys()].sort()) {
      const port = new ReplayTransport(corpus, caseId);
      const sequencer = new RequestSequencer({
        surface: corpus.surface,
        port,
        repoRoot: corpus.global.repoRoot,
        observationScope: { caseIds: [caseId] },
      });
      try {
        const result = await sequencer.run();
        const summary = result.ledger.summary();
        stats.push({
          caseId,
          discovered: result.candidates.some((c) => c.caseId === caseId),
          observed: summary.OBSERVED,
          unknown: summary.UNKNOWN,
          notAttempted: summary.NOT_ATTEMPTED,
        });
      } catch (e) {
        const err = e as Error & { code?: string };
        failures.push({ caseId, code: err.code, message: err.message.slice(0, 300) });
      }
    }

    if (failures.length > 0) {
       
      console.error(
        `transport refusals: ${failures.length}/${corpus.cases.size}\n` +
          failures
            .slice(0, 10)
            .map((f) => `  ${f.caseId} [${String(f.code)}] ${f.message}`)
            .join('\n'),
      );
    }
    expect(failures).toEqual([]);
    expect(stats).toHaveLength(corpus.cases.size);
    // Every case must be rediscovered by the Observer's own candidate expansion from global data;
    // a case the Observer cannot find is a case whose expectation is unreachable.
    expect(stats.filter((s) => !s.discovered)).toEqual([]);
  }, 300000);
});
