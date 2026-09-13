import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const script = resolve(
  root,
  'scripts/db/compare-public-prisma-baseline-catalogs.mjs',
);
const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

function catalog(columns: unknown[] = []) {
  return {
    capture_schema: 'public-prisma-baseline-catalog-v1',
    database: 'fixture',
    server_version: '16.4',
    extension_member_policy: 'exclude-members-capture-extension-identity',
    relations: [],
    columns,
    constraints: [],
    indexes: [],
    enums: [],
    views: [],
    materialized_views: [],
    functions: [],
    triggers: [],
    policies: [],
    sequences: [],
    extensions: [],
  };
}

function writeFixture(dir: string, name: string, value: unknown) {
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify(value), 'utf8');
  return path;
}

function runComparator(
  dir: string,
  actual: string,
  declared: string,
  historical: string,
) {
  const outJson = join(dir, 'comparison.json');
  const outMd = join(dir, 'comparison.md');
  const result = spawnSync(
    process.execPath,
    [
      script,
      '--actual',
      actual,
      '--declared',
      declared,
      '--historical',
      historical,
      '--out-json',
      outJson,
      '--out-md',
      outMd,
    ],
    { encoding: 'utf8' },
  );
  return { result, outJson, outMd };
}

describe('public Prisma baseline catalog comparison', () => {
  it('classifies history drift when ACTUAL and DECLARED agree', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mimer-public-prisma-compare-'));
    tempDirs.push(dir);

    const canonicalColumn = {
      relation: 'BankIdSession',
      ordinal_position: 1,
      column: 'identity_environment',
      data_type: 'text',
      not_null: true,
      identity_kind: '',
      generated_kind: '',
      default: "'LEGACY'::text",
      collation: null,
    };

    const actual = writeFixture(dir, 'actual.json', catalog([canonicalColumn]));
    const declared = writeFixture(
      dir,
      'declared.json',
      catalog([canonicalColumn]),
    );
    const historical = writeFixture(dir, 'historical.json', catalog([]));
    const run = runComparator(dir, actual, declared, historical);

    expect(run.result.status).toBe(0);
    const report = JSON.parse(readFileSync(run.outJson, 'utf8'));
    expect(report.counts.HISTORY_DRIFT).toBe(1);
    expect(report.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          section: 'columns',
          key: 'BankIdSession|identity_environment',
          classification: 'HISTORY_DRIFT',
        }),
      ]),
    );
  });


  it('ignores physical column order while preserving semantic column drift', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mimer-public-prisma-compare-'));
    tempDirs.push(dir);

    const base = {
      relation: 'BankIdSession',
      column: 'identity_environment',
      data_type: 'text',
      not_null: true,
      identity_kind: '',
      generated_kind: '',
      default: "'LEGACY'::text",
      collation: null,
    };

    const actual = writeFixture(
      dir,
      'actual.json',
      catalog([{ ...base, ordinal_position: 11 }]),
    );
    const declared = writeFixture(
      dir,
      'declared.json',
      catalog([{ ...base, ordinal_position: 7 }]),
    );
    const historical = writeFixture(
      dir,
      'historical.json',
      catalog([{ ...base, ordinal_position: 3 }]),
    );
    const run = runComparator(dir, actual, declared, historical);

    expect(run.result.status).toBe(0);
    const report = JSON.parse(readFileSync(run.outJson, 'utf8'));
    expect(report.counts.MATCH).toBe(1);
    expect(report.findings[0].actual.ordinal_position).toBe(11);
    expect(report.findings[0].declared.ordinal_position).toBe(7);
    expect(report.findings[0].historical.ordinal_position).toBe(3);
    expect(report.findings[0].actual_fingerprint).toBe(
      report.findings[0].declared_fingerprint,
    );
    expect(report.findings[0].declared_fingerprint).toBe(
      report.findings[0].historical_fingerprint,
    );
  });

  it('still treats semantic column differences as drift', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mimer-public-prisma-compare-'));
    tempDirs.push(dir);

    const base = {
      relation: 'User',
      column: 'organisationId',
      data_type: 'text',
      identity_kind: '',
      generated_kind: '',
      default: null,
      collation: null,
    };

    const actual = writeFixture(
      dir,
      'actual.json',
      catalog([{ ...base, ordinal_position: 11, not_null: false }]),
    );
    const declared = writeFixture(
      dir,
      'declared.json',
      catalog([{ ...base, ordinal_position: 7, not_null: false }]),
    );
    const historical = writeFixture(
      dir,
      'historical.json',
      catalog([{ ...base, ordinal_position: 3, not_null: true }]),
    );
    const run = runComparator(dir, actual, declared, historical);

    expect(run.result.status).toBe(0);
    const report = JSON.parse(readFileSync(run.outJson, 'utf8'));
    expect(report.counts.HISTORY_DRIFT).toBe(1);
  });

  it('requires owner decision when no two object contracts agree', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mimer-public-prisma-compare-'));
    tempDirs.push(dir);

    const base = {
      relation: 'User',
      ordinal_position: 1,
      column: 'organisationId',
      data_type: 'text',
      identity_kind: '',
      generated_kind: '',
      default: null,
      collation: null,
    };

    const actual = writeFixture(
      dir,
      'actual.json',
      catalog([{ ...base, not_null: false }]),
    );
    const declared = writeFixture(
      dir,
      'declared.json',
      catalog([{ ...base, not_null: true }]),
    );
    const historical = writeFixture(
      dir,
      'historical.json',
      catalog([{ ...base, data_type: 'character varying', not_null: true }]),
    );
    const run = runComparator(dir, actual, declared, historical);

    expect(run.result.status).toBe(0);
    const report = JSON.parse(readFileSync(run.outJson, 'utf8'));
    expect(report.counts.INTENT_REQUIRES_OWNER_DECISION).toBe(1);
  });

  it('fails closed on an unexpected catalog contract', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mimer-public-prisma-compare-'));
    tempDirs.push(dir);

    const actual = writeFixture(dir, 'actual.json', {
      ...catalog(),
      extension_member_policy: 'unexpected',
    });
    const declared = writeFixture(dir, 'declared.json', catalog());
    const historical = writeFixture(dir, 'historical.json', catalog());
    const run = runComparator(dir, actual, declared, historical);

    expect(run.result.status).not.toBe(0);
    expect(run.result.stderr).toContain('Unexpected extension_member_policy');
  });
});
