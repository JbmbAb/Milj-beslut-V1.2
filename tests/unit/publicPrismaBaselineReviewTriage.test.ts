import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const script = resolve(
  root,
  'scripts/db/triage-public-prisma-baseline-review.mjs',
);
const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function finding(
  section: string,
  key: string,
  classification: string,
  actual: unknown,
  declared: unknown,
  historical: unknown,
) {
  return {
    section,
    key,
    classification,
    actual_fingerprint: actual == null ? null : 'a-' + key,
    declared_fingerprint: declared == null ? null : 'd-' + key,
    historical_fingerprint: historical == null ? null : 'h-' + key,
    actual,
    declared,
    historical,
  };
}

function run(comparisonFindings: unknown[], ratificationFindings: unknown[]) {
  const dir = mkdtempSync(join(tmpdir(), 'mimer-public-prisma-triage-'));
  tempDirs.push(dir);

  const comparisonPath = join(dir, 'comparison.json');
  const ratificationPath = join(dir, 'ratification.json');
  const outJson = join(dir, 'triage.json');
  const outMd = join(dir, 'triage.md');

  const comparisonText = JSON.stringify({
    report_schema: 'public-prisma-baseline-comparison-v1',
    findings: comparisonFindings,
  });
  writeFileSync(comparisonPath, comparisonText, 'utf8');
  writeFileSync(
    ratificationPath,
    JSON.stringify({
      ratification_schema: 'public-prisma-baseline-ratification-v1',
      input_comparison_sha256: sha256(comparisonText),
      findings: ratificationFindings,
    }),
    'utf8',
  );

  const result = spawnSync(
    process.execPath,
    [
      script,
      '--comparison',
      comparisonPath,
      '--ratification',
      ratificationPath,
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

function review(section: string, key: string, source: string) {
  return {
    section,
    key,
    source_classification: source,
    ratification: 'REVIEW_REQUIRED',
    baseline_action: 'HOLD',
  };
}

describe('public Prisma baseline Phase C.1 triage', () => {
  it('isolates Prisma migration ledger findings', () => {
    const raw = finding(
      'columns',
      '_prisma_migrations|id',
      'DECLARED_DRIFT',
      { relation: '_prisma_migrations', column: 'id' },
      null,
      { relation: '_prisma_migrations', column: 'id' },
    );
    const result = run([raw], [review('columns', '_prisma_migrations|id', 'DECLARED_DRIFT')]);

    expect(result.result.status).toBe(0);
    expect(result.report.findings[0].triage_class).toBe(
      'PRISMA_SYSTEM_LEDGER_ARTIFACT',
    );
    expect(result.report.findings[0].baseline_blocking).toBe(false);
  });

  it('isolates pgvector version parity from Prisma baseline review', () => {
    const raw = finding(
      'extensions',
      'vector',
      'ACTUAL_DRIFT',
      { name: 'vector', version: '0.8.6', schema: 'public' },
      { name: 'vector', version: '0.8.2', schema: 'public' },
      { name: 'vector', version: '0.8.2', schema: 'public' },
    );
    const result = run([raw], [review('extensions', 'vector', 'ACTUAL_DRIFT')]);

    expect(result.result.status).toBe(0);
    expect(result.report.findings[0].triage_class).toBe(
      'ENVIRONMENT_EXTENSION_PARITY',
    );
    expect(result.report.findings[0].owner_decision_required).toBe(false);
  });

  it('pairs same-structure constraints under different names', () => {
    const actual = {
      relation: 'project_context_bindings',
      name: 'project_context_bindings_requested_by_user_i_fkey',
      type: 'f',
      validated: true,
      deferrable: false,
      initially_deferred: false,
      definition: 'FOREIGN KEY (requested_by_user_id) REFERENCES "User"(id)',
    };
    const declared = {
      ...actual,
      name: 'project_context_bindings_requested_by_u_fkey',
    };
    const a = finding(
      'constraints',
      'project_context_bindings|project_context_bindings_requested_by_user_i_fkey',
      'ACTUAL_ONLY',
      actual,
      null,
      null,
    );
    const d = finding(
      'constraints',
      'project_context_bindings|project_context_bindings_requested_by_u_fkey',
      'DECLARED_ONLY',
      null,
      declared,
      null,
    );
    const result = run(
      [a, d],
      [
        review('constraints', a.key, 'ACTUAL_ONLY'),
        review('constraints', d.key, 'DECLARED_ONLY'),
      ],
    );

    expect(result.result.status).toBe(0);
    expect(result.report.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          triage_class: 'MECHANICAL_NAME_DIVERGENCE',
          owner_decision_required: false,
        }),
      ]),
    );
  });

  it('pairs same-structure indexes after normalizing only the index identifier', () => {
    const actual = {
      relation: 'viewer_capability_provisioning_requests',
      name: 'viewer_capability_provisioning_requests_requested_by_user_id_idx',
      is_primary: false,
      is_unique: false,
      is_valid: true,
      is_ready: true,
      definition:
        'CREATE INDEX viewer_capability_provisioning_requests_requested_by_user_id_idx ON public.viewer_capability_provisioning_requests USING btree (requested_by_user_id)',
      predicate: null,
    };
    const declared = {
      ...actual,
      name: 'viewer_capability_provisioning_requests_requested_by_user_i_idx',
      definition:
        'CREATE INDEX viewer_capability_provisioning_requests_requested_by_user_i_idx ON public.viewer_capability_provisioning_requests USING btree (requested_by_user_id)',
    };
    const a = finding('indexes', 'viewer_capability_provisioning_requests|A', 'ACTUAL_ONLY', actual, null, null);
    const d = finding('indexes', 'viewer_capability_provisioning_requests|D', 'DECLARED_ONLY', null, declared, null);
    const result = run(
      [a, d],
      [review('indexes', a.key, 'ACTUAL_ONLY'), review('indexes', d.key, 'DECLARED_ONLY')],
    );

    expect(result.result.status).toBe(0);
    expect(result.report.findings.every(
      (item: { triage_class: string }) =>
        item.triage_class === 'MECHANICAL_NAME_DIVERGENCE',
    )).toBe(true);
  });

  it('fails closed on ambiguous name-only pairing', () => {
    const base = {
      relation: 'Example',
      type: 'u',
      validated: true,
      deferrable: false,
      initially_deferred: false,
      definition: 'UNIQUE (value)',
    };
    const actualA = finding(
      'constraints',
      'Example|actual_a',
      'ACTUAL_ONLY',
      { ...base, name: 'actual_a' },
      null,
      null,
    );
    const actualB = finding(
      'constraints',
      'Example|actual_b',
      'ACTUAL_ONLY',
      { ...base, name: 'actual_b' },
      null,
      null,
    );
    const declared = finding(
      'constraints',
      'Example|declared',
      'DECLARED_ONLY',
      null,
      { ...base, name: 'declared' },
      null,
    );
    const result = run(
      [actualA, actualB, declared],
      [
        review('constraints', actualA.key, 'ACTUAL_ONLY'),
        review('constraints', actualB.key, 'ACTUAL_ONLY'),
        review('constraints', declared.key, 'DECLARED_ONLY'),
      ],
    );

    expect(result.result.status).toBe(0);
    expect(result.report.findings.every(
      (item: { triage_class: string }) =>
        item.triage_class === 'AMBIGUOUS_STRUCTURAL_NAME_PAIR',
    )).toBe(true);
  });

  it('keeps real column contract disagreements for owner review', () => {
    const raw = finding(
      'columns',
      'User|organisationId',
      'INTENT_REQUIRES_OWNER_DECISION',
      { relation: 'User', column: 'organisationId', data_type: 'text', not_null: false },
      { relation: 'User', column: 'organisationId', data_type: 'text', not_null: true },
      { relation: 'User', column: 'organisationId', data_type: 'character varying', not_null: true },
    );
    const result = run([raw], [review('columns', 'User|organisationId', 'INTENT_REQUIRES_OWNER_DECISION')]);

    expect(result.result.status).toBe(0);
    expect(result.report.findings[0].triage_class).toBe(
      'TRUE_SCHEMA_REVIEW_REQUIRED',
    );
    expect(result.report.findings[0].owner_decision_required).toBe(true);
  });

  it('fails closed when ratification does not bind to supplied comparison bytes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mimer-public-prisma-triage-'));
    tempDirs.push(dir);
    const comparisonPath = join(dir, 'comparison.json');
    const ratificationPath = join(dir, 'ratification.json');
    const outJson = join(dir, 'triage.json');
    const outMd = join(dir, 'triage.md');
    writeFileSync(
      comparisonPath,
      JSON.stringify({
        report_schema: 'public-prisma-baseline-comparison-v1',
        findings: [],
      }),
      'utf8',
    );
    writeFileSync(
      ratificationPath,
      JSON.stringify({
        ratification_schema: 'public-prisma-baseline-ratification-v1',
        input_comparison_sha256: 'wrong',
        findings: [],
      }),
      'utf8',
    );

    const result = spawnSync(
      process.execPath,
      [
        script,
        '--comparison',
        comparisonPath,
        '--ratification',
        ratificationPath,
        '--out-json',
        outJson,
        '--out-md',
        outMd,
      ],
      { encoding: 'utf8' },
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      'Ratification does not bind to the supplied comparison bytes',
    );
  });
});