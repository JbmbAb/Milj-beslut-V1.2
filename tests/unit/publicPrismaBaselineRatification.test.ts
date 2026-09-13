import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const script = resolve(
  root,
  'scripts/db/ratify-public-prisma-baseline-comparison.mjs',
);
const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

function finding(
  classification: string,
  actual: string | null,
  declared: string | null,
  historical: string | null,
  key = 'T|c',
) {
  return {
    section: 'columns',
    key,
    classification,
    actual_fingerprint: actual,
    declared_fingerprint: declared,
    historical_fingerprint: historical,
  };
}

function run(findings: unknown[]) {
  const dir = mkdtempSync(join(tmpdir(), 'mimer-public-prisma-ratify-'));
  tempDirs.push(dir);

  const comparison = join(dir, 'comparison.json');
  const outJson = join(dir, 'ratification.json');
  const outMd = join(dir, 'ratification.md');

  writeFileSync(
    comparison,
    JSON.stringify({
      report_schema: 'public-prisma-baseline-comparison-v1',
      findings,
    }),
    'utf8',
  );

  const result = spawnSync(
    process.execPath,
    [
      script,
      '--comparison',
      comparison,
      '--out-json',
      outJson,
      '--out-md',
      outMd,
    ],
    { encoding: 'utf8' },
  );

  return {
    result,
    report: result.status === 0 ? JSON.parse(readFileSync(outJson, 'utf8')) : null,
  };
}

describe('public Prisma baseline recovery-reference ratification', () => {
  it('ratifies MATCH, HISTORY_DRIFT and HISTORY_ONLY from ACTUAL/DECLARED agreement', () => {
    const runResult = run([
      finding('MATCH', 'a', 'a', 'a', 'A|match'),
      finding('HISTORY_DRIFT', 'b', 'b', 'old', 'B|drift'),
      finding('HISTORY_ONLY', null, null, 'legacy', 'C|legacy'),
    ]);

    expect(runResult.result.status).toBe(0);
    expect(runResult.report.summary).toMatchObject({
      total: 3,
      ratified: 3,
      review_required: 0,
    });
    expect(runResult.report.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'B|drift',
          baseline_action: 'BASELINE_TO_RECOVERY_REFERENCE',
        }),
        expect.objectContaining({
          key: 'C|legacy',
          baseline_action: 'EXCLUDE_FROM_NEW_BASELINE',
        }),
      ]),
    );
  });

  it('holds every finding where ACTUAL and DECLARED disagree', () => {
    const runResult = run([
      finding('DECLARED_DRIFT', 'a', 'd', 'a', 'D|declared-drift'),
      finding('DECLARED_ONLY', null, 'd', null, 'E|declared-only'),
      finding('ACTUAL_ONLY', 'a', null, null, 'F|actual-only'),
      finding('ACTUAL_DRIFT', 'a', 'd', 'd', 'G|actual-drift'),
      finding(
        'INTENT_REQUIRES_OWNER_DECISION',
        'a',
        'd',
        'h',
        'H|owner',
      ),
    ]);

    expect(runResult.result.status).toBe(0);
    expect(runResult.report.summary).toMatchObject({
      total: 5,
      ratified: 0,
      review_required: 5,
    });
    expect(
      runResult.report.findings.every(
        (finding: { baseline_action: string }) => finding.baseline_action === 'HOLD',
      ),
    ).toBe(true);
  });

  it('fails closed on an unexpected input report contract', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mimer-public-prisma-ratify-'));
    tempDirs.push(dir);

    const comparison = join(dir, 'comparison.json');
    const outJson = join(dir, 'ratification.json');
    const outMd = join(dir, 'ratification.md');
    writeFileSync(
      comparison,
      JSON.stringify({ report_schema: 'unexpected', findings: [] }),
      'utf8',
    );

    const result = spawnSync(
      process.execPath,
      [
        script,
        '--comparison',
        comparison,
        '--out-json',
        outJson,
        '--out-md',
        outMd,
      ],
      { encoding: 'utf8' },
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Unsupported report_schema');
  });
});