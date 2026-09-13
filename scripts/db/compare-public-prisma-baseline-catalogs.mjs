#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import process from 'node:process';

const SECTION_KEYS = {
  relations: (x) => x.name + '|' + x.kind,
  columns: (x) => x.relation + '|' + x.column,
  constraints: (x) => x.relation + '|' + x.name,
  indexes: (x) => x.relation + '|' + x.name,
  enums: (x) => x.name + '|' + x.value,
  views: (x) => x.schema + '|' + x.name,
  materialized_views: (x) => x.schema + '|' + x.name,
  functions: (x) => x.name + '|' + x.identity_arguments,
  triggers: (x) => x.relation + '|' + x.name,
  policies: (x) => x.relation + '|' + x.name,
  sequences: (x) => x.schema + '|' + x.name,
  extensions: (x) => x.name,
};

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, nested]) => [key, stable(nested)]),
    );
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(stable(value));
}

function fingerprint(value) {
  if (value == null) return null;
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

function readCatalog(path) {
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  if (parsed.capture_schema !== 'public-prisma-baseline-catalog-v1') {
    throw new Error(
      'Unsupported capture_schema in ' +
        path +
        ': ' +
        (parsed.capture_schema ?? '<missing>'),
    );
  }
  if (
    parsed.extension_member_policy !==
    'exclude-members-capture-extension-identity'
  ) {
    throw new Error(
      'Unexpected extension_member_policy in ' +
        path +
        ': ' +
        (parsed.extension_member_policy ?? '<missing>'),
    );
  }
  return parsed;
}

function indexSection(catalog, section) {
  const keyFn = SECTION_KEYS[section];
  const entries = catalog[section];
  if (!Array.isArray(entries)) {
    throw new Error('Section ' + section + ' is not an array');
  }

  const map = new Map();
  for (const entry of entries) {
    const key = keyFn(entry);
    if (map.has(key)) {
      throw new Error('Duplicate identity in ' + section + ': ' + key);
    }
    map.set(key, entry);
  }
  return map;
}

function classify(actual, declared, historical) {
  const a = fingerprint(actual);
  const d = fingerprint(declared);
  const h = fingerprint(historical);

  if (a === d && d === h) return 'MATCH';
  if (a === d && a !== null && h !== a) return 'HISTORY_DRIFT';
  if (a === h && a !== null && d !== a) return 'DECLARED_DRIFT';
  if (d === h && d !== null && a !== d) return 'ACTUAL_DRIFT';

  if (a !== null && d === null && h === null) return 'ACTUAL_ONLY';
  if (a === null && d !== null && h === null) return 'DECLARED_ONLY';
  if (a === null && d === null && h !== null) return 'HISTORY_ONLY';

  return 'INTENT_REQUIRES_OWNER_DECISION';
}

export function compareCatalogs(actualCatalog, declaredCatalog, historicalCatalog) {
  const findings = [];

  for (const section of Object.keys(SECTION_KEYS)) {
    const actual = indexSection(actualCatalog, section);
    const declared = indexSection(declaredCatalog, section);
    const historical = indexSection(historicalCatalog, section);
    const keys = [
      ...new Set([...actual.keys(), ...declared.keys(), ...historical.keys()]),
    ].sort();

    for (const key of keys) {
      const actualValue = actual.get(key) ?? null;
      const declaredValue = declared.get(key) ?? null;
      const historicalValue = historical.get(key) ?? null;
      const classification = classify(
        actualValue,
        declaredValue,
        historicalValue,
      );

      findings.push({
        section,
        key,
        classification,
        actual_fingerprint: fingerprint(actualValue),
        declared_fingerprint: fingerprint(declaredValue),
        historical_fingerprint: fingerprint(historicalValue),
        actual: actualValue,
        declared: declaredValue,
        historical: historicalValue,
      });
    }
  }

  const counts = findings.reduce((acc, finding) => {
    acc[finding.classification] = (acc[finding.classification] ?? 0) + 1;
    return acc;
  }, {});

  return {
    report_schema: 'public-prisma-baseline-comparison-v1',
    catalogs: {
      actual_database: actualCatalog.database,
      declared_database: declaredCatalog.database,
      historical_database: historicalCatalog.database,
      actual_server_version: actualCatalog.server_version,
      declared_server_version: declaredCatalog.server_version,
      historical_server_version: historicalCatalog.server_version,
    },
    counts,
    findings,
  };
}

function markdown(report) {
  const orderedCounts = Object.entries(report.counts).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const blocking = report.findings.filter(
    (finding) => finding.classification !== 'MATCH',
  );

  const lines = [
    '# PUBLIC-PRISMA-BASELINE-RECONCILIATION-01 — Phase B comparison',
    '',
    'Status: **COMPARISON_ONLY — NO BASELINE DDL AUTHORIZED**',
    '',
    '## Catalog identities',
    '',
    '- ACTUAL: ' +
      report.catalogs.actual_database +
      ' / PostgreSQL ' +
      report.catalogs.actual_server_version,
    '- DECLARED: ' +
      report.catalogs.declared_database +
      ' / PostgreSQL ' +
      report.catalogs.declared_server_version,
    '- HISTORICAL: ' +
      report.catalogs.historical_database +
      ' / PostgreSQL ' +
      report.catalogs.historical_server_version,
    '',
    '## Classification counts',
    '',
    '| Classification | Count |',
    '|---|---:|',
    ...orderedCounts.map(([name, count]) => '| ' + name + ' | ' + count + ' |'),
    '',
    '## Non-matching findings',
    '',
    '| Section | Identity | Classification | ACTUAL | DECLARED | HISTORICAL |',
    '|---|---|---|---|---|---|',
    ...blocking.map(
      (finding) =>
        '| ' +
        finding.section +
        ' | ' +
        finding.key.replaceAll('|', '\\|') +
        ' | ' +
        finding.classification +
        ' | ' +
        (finding.actual_fingerprint?.slice(0, 12) ?? '—') +
        ' | ' +
        (finding.declared_fingerprint?.slice(0, 12) ?? '—') +
        ' | ' +
        (finding.historical_fingerprint?.slice(0, 12) ?? '—') +
        ' |',
    ),
    '',
    '## Interpretation',
    '',
    '- HISTORY_DRIFT: ACTUAL and DECLARED agree; migration-derived state differs.',
    '- DECLARED_DRIFT: ACTUAL and HISTORICAL agree; schema declaration differs.',
    '- ACTUAL_DRIFT: DECLARED and HISTORICAL agree; running database differs.',
    '- *_ONLY: object exists in only one state.',
    '- INTENT_REQUIRES_OWNER_DECISION: no two states establish the same object contract.',
    '',
    'This report is evidence for ratification. It does not authorize DDL, ledger mutation, migration deletion, merge, or promotion.',
    '',
  ];

  return lines.join('\n');
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith('--') || value == null) {
      throw new Error('Arguments must be provided as --name value pairs');
    }
    args[flag.slice(2)] = value;
  }

  for (const required of ['actual', 'declared', 'historical', 'out-json', 'out-md']) {
    if (!args[required]) throw new Error('Missing --' + required);
  }

  return args;
}

try {
    const args = parseArgs(process.argv.slice(2));
    const actual = readCatalog(resolve(args.actual));
    const declared = readCatalog(resolve(args.declared));
    const historical = readCatalog(resolve(args.historical));
    const report = compareCatalogs(actual, declared, historical);

    const outJson = resolve(args['out-json']);
    const outMd = resolve(args['out-md']);
    mkdirSync(dirname(outJson), { recursive: true });
    mkdirSync(dirname(outMd), { recursive: true });
    writeFileSync(outJson, JSON.stringify(report, null, 2) + '\n', 'utf8');
    writeFileSync(outMd, markdown(report) + '\n', 'utf8');

    process.stdout.write(
      JSON.stringify({
        status: 'COMPARISON_COMPLETE_NOT_RATIFIED',
        out_json: outJson,
        out_md: outMd,
        counts: report.counts,
      }) + '\n',
    );
} catch (error) {
  process.stderr.write(
    (error instanceof Error ? error.stack : String(error)) + '\n',
  );
  process.exitCode = 1;
}
