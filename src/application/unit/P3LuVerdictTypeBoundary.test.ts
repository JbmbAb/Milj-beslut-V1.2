/**
 * LU_VERDICT_TYPE_BOUNDARY_V1 — the compile proof, run as a test.
 *
 *   A governed LU verdict and a non-verdict result MUST be distinct TypeScript variants.
 *   No consumer may read verdict-only fields without first proving that the value is a
 *   governed verdict.
 *
 * The proof itself lives in `src/application/types/LuVerdictTypeBoundary.type-proof.ts` and is
 * written in `@ts-expect-error` directives; this file only invokes the compiler and reports.
 * A directive that stops being needed — because the union was flattened back into optional
 * fields, say — is itself an error (TS2578 "Unused '@ts-expect-error' directive"), so the
 * proof fails in both directions.
 *
 * Why this is not a Vitest guard like its siblings in this directory: the defect it closes is
 * that a *future* consumer gets no compiler help. No runtime assertion can observe code that
 * has not been written. `NoAlternateLuDecisionPath.test.ts` and `P3LuVerdictPdfProjection.test.ts`
 * remain the runtime enforcement for the consumers that exist; this covers the ones that do not
 * exist yet.
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const PROJECT = 'tsconfig.lu-verdict.json';

/**
 * The files this unit takes responsibility for. Any compiler error here fails the gate.
 */
const GOVERNED_SURFACE = [
  'src/application/generate-localization-report.usecase.ts',
  'src/application/types/LuVerdictTypeBoundary.type-proof.ts',
  'server/services/localizationPdfService.ts',
  'server/services/localizationReportService.ts',
  'server/modules/localization/',
];

/**
 * Errors that already existed in the transitive closure when this project was introduced, in
 * files outside the LU verdict surface.
 *
 * They are tolerated, not endorsed. Repairing them is LU_TYPESCRIPT_GATE-01 — the separate
 * defect that `packages/mps-lu`, `src/application` and `server` still have no hermetic,
 * continuous typecheck gate. Listing them by FILE rather than by message keeps this test from
 * failing when that programme fixes one; an error in any file NOT listed here is new, and
 * fails.
 */
const KNOWN_UNGATED_FILES = [
  'packages/mps-artifact-store/src/internal/stubs.ts',
  'packages/mps-lu/src/execution/LuExecutionKernelClient.ts',
  'packages/mps-lu/src/services/EvidenceRAGService.ts',
  'packages/mps-runtime/src/index.ts',
  'packages/mps-runtime/src/kernel/ExecutionKernel.ts',
  'packages/mps-runtime/src/kernel/RuntimeState.ts',
  'src/infrastructure/PrismaExecutionTicketQueue.ts',
];

interface TscError {
  file: string;
  line: string;
}

function runTypeCheck(): TscError[] {
  let output: string;
  try {
    // The compiler's JS entrypoint, run on this Node. Not `npx tsc`: that resolves a shim
    // (`npx.cmd` on Windows) which Node refuses to spawn without a shell.
    output = execFileSync(
      process.execPath,
      [path.join(REPO_ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), '--noEmit', '-p', PROJECT],
      { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } catch (err) {
    // tsc exits non-zero whenever it reports anything. The diagnostics are the payload, so a
    // non-zero exit is expected input here, not a failure to run.
    const e = err as { stdout?: string; stderr?: string; code?: string };
    if (e.stdout === undefined && e.stderr === undefined) throw err;
    output = `${e.stdout ?? ''}${e.stderr ?? ''}`;
  }

  return output
    .split(/\r?\n/)
    .filter((line) => / error TS\d+: /.test(line))
    .map((line) => ({ file: line.slice(0, line.indexOf('(')).replace(/\\/g, '/'), line }));
}

describe('LU_VERDICT_TYPE_BOUNDARY_V1', () => {
  const errors = runTypeCheck();

  it('compiles the LU verdict surface without error', () => {
    const inSurface = errors.filter((e) => GOVERNED_SURFACE.some((p) => e.file.startsWith(p)));

    expect(
      inSurface.map((e) => e.line),
      'LU_VERDICT_TYPE_BOUNDARY_V1 is broken. An unused @ts-expect-error in the type-proof ' +
        'means the union no longer rejects an unguarded verdict read; any other error means a ' +
        'consumer reads a verdict field without narrowing on assessment_status.',
    ).toEqual([]);
  }, 180_000);

  it('introduces no new errors elsewhere in the LU import closure', () => {
    const unexpected = errors.filter(
      (e) =>
        !GOVERNED_SURFACE.some((p) => e.file.startsWith(p)) &&
        !KNOWN_UNGATED_FILES.includes(e.file),
    );

    expect(
      unexpected.map((e) => e.line),
      'A file outside the LU verdict surface started failing to compile. Either fix it, or — ' +
        'if it is pre-existing breakage owned by LU_TYPESCRIPT_GATE-01 — add it to ' +
        'KNOWN_UNGATED_FILES with a reason.',
    ).toEqual([]);
  }, 180_000);
});
