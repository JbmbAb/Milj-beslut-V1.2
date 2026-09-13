#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import process from 'node:process';

function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

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
  return sha256Bytes(Buffer.from(stableJson(value), 'utf8'));
}

function readJson(path) {
  const bytes = readFileSync(path);
  return { bytes, parsed: JSON.parse(bytes.toString('utf8')) };
}

function normalizeWhitespace(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : value;
}

function normalizeIndexDefinition(definition) {
  if (typeof definition !== 'string') return definition;
  const normalized = normalizeWhitespace(definition);
  return normalized.replace(
    /^(CREATE\s+(?:UNIQUE\s+)?INDEX\s+)(?:"(?:[^"]|"")*"|[^\s]+)(\s+ON\s+)/i,
    '$1<INDEX_NAME>$2',
  );
}

function structuralValue(section, value) {
  if (value == null) return null;

  if (section === 'constraints') {
    const { name: _name, ...rest } = value;
    return {
      ...rest,
      definition: normalizeWhitespace(rest.definition),
    };
  }

  if (section === 'indexes') {
    const { name: _name, ...rest } = value;
    return {
      ...rest,
      definition: normalizeIndexDefinition(rest.definition),
      predicate: normalizeWhitespace(rest.predicate),
    };
  }

  return value;
}

function structuralFingerprint(section, value) {
  const structural = structuralValue(section, value);
  return structural == null ? null : fingerprint(structural);
}

function relationName(section, key, raw) {
  if (raw?.relation) return raw.relation;
  if (section === 'relations') return String(key).split('|')[0];
  return String(key).split('|')[0];
}

function isPrismaLedgerFinding(finding, comparisonFinding) {
  const candidates = [
    comparisonFinding?.actual,
    comparisonFinding?.declared,
    comparisonFinding?.historical,
  ];
  return (
    relationName(finding.section, finding.key, candidates.find(Boolean)) ===
    '_prisma_migrations'
  );
}

function comparisonKey(section, key) {
  return section + '\u0000' + key;
}

function makeBaseTriage(finding, comparisonFinding) {
  return {
    section: finding.section,
    key: finding.key,
    source_classification: finding.source_classification,
    actual_fingerprint: finding.actual_fingerprint ?? null,
    declared_fingerprint: finding.declared_fingerprint ?? null,
    historical_fingerprint: finding.historical_fingerprint ?? null,
    actual: comparisonFinding.actual ?? null,
    declared: comparisonFinding.declared ?? null,
    historical: comparisonFinding.historical ?? null,
  };
}

function pairNameOnly(findings) {
  const paired = new Map();
  const ambiguous = new Set();

  for (const section of ['constraints', 'indexes']) {
    const sectionFindings = findings.filter((item) => item.section === section);
    const actualOnly = sectionFindings.filter(
      (item) => item.actual != null && item.declared == null,
    );
    const declaredOnly = sectionFindings.filter(
      (item) => item.actual == null && item.declared != null,
    );

    const bySignature = new Map();
    for (const item of declaredOnly) {
      const signature =
        relationName(section, item.key, item.declared) +
        '\u0000' +
        structuralFingerprint(section, item.declared);
      const bucket = bySignature.get(signature) ?? [];
      bucket.push(item);
      bySignature.set(signature, bucket);
    }

    for (const item of actualOnly) {
      const signature =
        relationName(section, item.key, item.actual) +
        '\u0000' +
        structuralFingerprint(section, item.actual);
      const matches = bySignature.get(signature) ?? [];

      if (matches.length === 1) {
        const partner = matches[0];
        if (paired.has(partner.id)) {
          ambiguous.add(item.id);
          ambiguous.add(partner.id);
          continue;
        }
        paired.set(item.id, partner.id);
        paired.set(partner.id, item.id);
      } else if (matches.length > 1) {
        ambiguous.add(item.id);
        for (const partner of matches) ambiguous.add(partner.id);
      }
    }
  }

  return { paired, ambiguous };
}

export function triageComparison(comparison, ratification) {
  const comparisonMap = new Map(
    comparison.findings.map((finding) => [
      comparisonKey(finding.section, finding.key),
      finding,
    ]),
  );

  const review = ratification.findings
    .filter((finding) => finding.ratification === 'REVIEW_REQUIRED')
    .map((finding, index) => {
      const raw = comparisonMap.get(comparisonKey(finding.section, finding.key));
      if (!raw) {
        throw new Error(
          'Missing comparison finding for ' + finding.section + '|' + finding.key,
        );
      }
      return {
        id: String(index),
        ...makeBaseTriage(finding, raw),
      };
    });

  const { paired, ambiguous } = pairNameOnly(review);

  const triaged = review.map((item) => {
    if (isPrismaLedgerFinding(item, item)) {
      return {
        ...item,
        triage_class: 'PRISMA_SYSTEM_LEDGER_ARTIFACT',
        owner_decision_required: false,
        baseline_blocking: false,
        disposition: 'EXCLUDE_FROM_APPLICATION_BASELINE_OBJECT_REVIEW',
        reason:
          'Prisma migration ledger metadata, not an application schema object declared in schema.prisma.',
      };
    }

    if (item.section === 'extensions' && item.key === 'vector') {
      return {
        ...item,
        triage_class: 'ENVIRONMENT_EXTENSION_PARITY',
        owner_decision_required: false,
        baseline_blocking: false,
        disposition: 'HAND_OFF_TO_POSTGRES_EXTENSION_PARITY_01',
        reason:
          'Extension version parity belongs to database runtime provisioning, not Prisma public baseline DDL.',
      };
    }

    if (ambiguous.has(item.id)) {
      return {
        ...item,
        triage_class: 'AMBIGUOUS_STRUCTURAL_NAME_PAIR',
        owner_decision_required: false,
        baseline_blocking: true,
        disposition: 'REVIEW_PAIRING_BEFORE_BASELINE',
        reason:
          'More than one same-relation object has the same name-insensitive structural signature; pairing is not unique.',
      };
    }

    if (paired.has(item.id)) {
      const partnerId = paired.get(item.id);
      const partner = review.find((candidate) => candidate.id === partnerId);
      return {
        ...item,
        triage_class: 'MECHANICAL_NAME_DIVERGENCE',
        owner_decision_required: false,
        baseline_blocking: true,
        paired_with: partner ? partner.key : null,
        structural_fingerprint: structuralFingerprint(
          item.section,
          item.actual ?? item.declared,
        ),
        disposition: 'CHOOSE_CANONICAL_NAME_IN_BASELINE_DESIGN',
        reason:
          'ACTUAL and DECLARED contain structurally equivalent same-relation objects under different identifiers.',
      };
    }

    if (
      ['constraints', 'indexes'].includes(item.section) &&
      item.actual != null &&
      item.declared != null &&
      structuralFingerprint(item.section, item.actual) ===
        structuralFingerprint(item.section, item.declared)
    ) {
      return {
        ...item,
        triage_class: 'MECHANICAL_RENDERING_DIVERGENCE',
        owner_decision_required: false,
        baseline_blocking: true,
        structural_fingerprint: structuralFingerprint(item.section, item.actual),
        disposition: 'NORMALIZE_IN_BASELINE_DESIGN',
        reason:
          'Same identity and same name-insensitive structure; captured rendering differs without a structural contract change.',
      };
    }

    return {
      ...item,
      triage_class: 'TRUE_SCHEMA_REVIEW_REQUIRED',
      owner_decision_required: true,
      baseline_blocking: true,
      disposition: 'EXPLICIT_SCHEMA_INTENT_REVIEW',
      reason:
        'ACTUAL and DECLARED remain structurally different after system-ledger, environment and name-only normalization.',
    };
  });

  const summary = triaged.reduce(
    (acc, item) => {
      acc.total += 1;
      acc.by_triage_class[item.triage_class] =
        (acc.by_triage_class[item.triage_class] ?? 0) + 1;
      if (item.owner_decision_required) acc.owner_decision_required += 1;
      if (item.baseline_blocking) acc.baseline_blocking += 1;
      return acc;
    },
    {
      total: 0,
      owner_decision_required: 0,
      baseline_blocking: 0,
      by_triage_class: {},
    },
  );

  return {
    triage_schema: 'public-prisma-baseline-review-triage-v1',
    summary,
    findings: triaged,
  };
}

function markdown(report, comparisonSha, ratificationSha) {
  const lines = [
    '# PUBLIC-PRISMA-BASELINE-RECONCILIATION-01 — Phase C.1 review triage',
    '',
    'Status: **REVIEW_TRIAGE_COMPLETE — BASELINE DDL NOT AUTHORIZED**',
    '',
    'Comparison SHA-256: `' + comparisonSha + '`',
    'Ratification SHA-256: `' + ratificationSha + '`',
    '',
    '## Summary',
    '',
    '| Measure | Count |',
    '|---|---:|',
    '| Review-required input findings | ' + report.summary.total + ' |',
    '| Owner decisions still required | ' + report.summary.owner_decision_required + ' |',
    '| Baseline-design blockers | ' + report.summary.baseline_blocking + ' |',
    '',
    '## Triage classes',
    '',
    '| Class | Count |',
    '|---|---:|',
    ...Object.entries(report.summary.by_triage_class)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, count]) => '| ' + name + ' | ' + count + ' |'),
    '',
    '## Findings',
    '',
    '| Section | Identity | Triage | Owner decision | Disposition |',
    '|---|---|---|---|---|',
    ...report.findings.map(
      (item) =>
        '| ' +
        item.section +
        ' | ' +
        String(item.key).replaceAll('|', '\\|') +
        ' | ' +
        item.triage_class +
        ' | ' +
        (item.owner_decision_required ? 'YES' : 'NO') +
        ' | ' +
        item.disposition +
        ' |',
    ),
    '',
    '## Stop boundary',
    '',
    'Name-only equivalence is not auto-ratification. Canonical object names are chosen later during baseline design so existing-production adoption and fresh reconstruction can both be proven.',
    '',
    'No baseline SQL, migration-ledger mutation, migration deletion, merge or promotion is authorized by this triage.',
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
  for (const required of [
    'comparison',
    'ratification',
    'out-json',
    'out-md',
  ]) {
    if (!args[required]) throw new Error('Missing --' + required);
  }
  return args;
}

try {
  const args = parseArgs(process.argv.slice(2));
  const comparisonInput = readJson(resolve(args.comparison));
  const ratificationInput = readJson(resolve(args.ratification));
  const comparisonSha = sha256Bytes(comparisonInput.bytes);
  const ratificationSha = sha256Bytes(ratificationInput.bytes);

  if (
    comparisonInput.parsed.report_schema !==
    'public-prisma-baseline-comparison-v1'
  ) {
    throw new Error('Unsupported comparison report schema');
  }
  if (
    ratificationInput.parsed.ratification_schema !==
    'public-prisma-baseline-ratification-v1'
  ) {
    throw new Error('Unsupported ratification report schema');
  }
  if (ratificationInput.parsed.input_comparison_sha256 !== comparisonSha) {
    throw new Error(
      'Ratification does not bind to the supplied comparison bytes',
    );
  }

  const report = triageComparison(
    comparisonInput.parsed,
    ratificationInput.parsed,
  );
  report.input_comparison_sha256 = comparisonSha;
  report.input_ratification_sha256 = ratificationSha;

  const outJson = resolve(args['out-json']);
  const outMd = resolve(args['out-md']);
  mkdirSync(dirname(outJson), { recursive: true });
  mkdirSync(dirname(outMd), { recursive: true });
  writeFileSync(outJson, JSON.stringify(report, null, 2) + '\n', 'utf8');
  writeFileSync(
    outMd,
    markdown(report, comparisonSha, ratificationSha) + '\n',
    'utf8',
  );

  process.stdout.write(
    JSON.stringify({
      status: 'REVIEW_TRIAGE_COMPLETE_NOT_BASELINED',
      total: report.summary.total,
      owner_decision_required: report.summary.owner_decision_required,
      baseline_blocking: report.summary.baseline_blocking,
      by_triage_class: report.summary.by_triage_class,
      out_json: outJson,
      out_md: outMd,
    }) + '\n',
  );
} catch (error) {
  process.stderr.write(
    (error instanceof Error ? error.stack : String(error)) + '\n',
  );
  process.exitCode = 1;
}