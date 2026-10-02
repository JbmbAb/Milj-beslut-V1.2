// tests/unit/retainSpatialDatasetVersionsCli.test.ts
//
// U30-B3: the retention backfill CLI is a thin, read-only-against-the-database shell over
// backfillSpatialDatasetRetention (covered in packages/spatial-provider-postgis/tests). Here: its
// argument parsing, its default targets, and that its SQL port refuses every non-query statement.
// Importing the CLI module must not run it (no pool, no connection). No database, no CAS.

import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_RETENTION_TARGETS,
  createReadOnlySqlPort,
  parseRetentionCliArgs,
  retentionCliExitCode,
} from '../../scripts/ops/retain-spatial-dataset-versions';

describe('retain-spatial-dataset-versions CLI (U30-B3)', () => {
  it('defaults to the five LU layers plus the property root source table', () => {
    expect([...DEFAULT_RETENTION_TARGETS].sort()).toEqual(
      [
        'env.ebh_potentiellt_fororenade_omraden',
        'env.natura2000_area',
        'env.protected_area',
        'env.registerenhetsomradesytor',
        'env.sgu_well',
        'env.water_protection_area',
      ].sort(),
    );
    const parsed = parseRetentionCliArgs([]);
    expect(parsed.execute).toBe(false);
    expect(parsed.targets).toHaveLength(6);
  });

  it('plan by default; --execute and --target are explicit', () => {
    expect(parseRetentionCliArgs(['--target', 'env.sgu_well'])).toEqual({
      targets: [{ schema: 'env', table: 'sgu_well' }],
      execute: false,
      measureDigest: false,
    });
    expect(parseRetentionCliArgs(['--target', 'env.sgu_well', '--target', 'env.protected_area', '--execute'])).toEqual({
      targets: [
        { schema: 'env', table: 'sgu_well' },
        { schema: 'env', table: 'protected_area' },
      ],
      execute: true,
      measureDigest: false,
    });
    expect(parseRetentionCliArgs(['--measure-digest', '--target', 'env.registerenhetsomradesytor'])).toEqual({
      targets: [{ schema: 'env', table: 'registerenhetsomradesytor' }],
      execute: false,
      measureDigest: true,
    });
  });

  it.each([
    [['--target']],
    [['--target', '--execute']],
    [['--target', 'sgu_well']],
    [['--target', 'env.x;drop']],
    [['--force']],
    [['--measure-digest', '--execute']],
  ])('rejects %j', (argv) => {
    expect(() => parseRetentionCliArgs(argv as string[])).toThrow();
  });

  it('F3: a failed basis exits 1; UNVERIFIED_BASIS (a superseded version, never recorded) is reported, not a failure', () => {
    expect(retentionCliExitCode([{ status: 'RECORDED' }, { status: 'UNVERIFIED_BASIS' }])).toBe(0);
    expect(retentionCliExitCode([{ status: 'LEDGER_ROW_COUNT_MISMATCH' }])).toBe(1);
    expect(retentionCliExitCode([{ status: 'DIGEST_MISMATCH' }])).toBe(1);
    expect(retentionCliExitCode([{ status: 'FAILED' }])).toBe(1);
  });

  it('the SQL port passes queries through and refuses any statement', async () => {
    const pool = { query: vi.fn(async () => ({ rows: [{ a: 1 }] })) };
    const port = createReadOnlySqlPort(pool as never);
    await expect(port.query('SELECT 1 AS a', [])).resolves.toEqual({ rows: [{ a: 1 }] });
    await expect(port.execute('CREATE TABLE lm_staging.x AS SELECT 1')).rejects.toThrow(/RETENTION_CLI_READ_ONLY/);
    await expect(port.execute('TRUNCATE env.sgu_well')).rejects.toThrow(/RETENTION_CLI_READ_ONLY/);
    expect(pool.query).toHaveBeenCalledTimes(1);
  });
});
