#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import process from 'node:process';

function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function readComparison(path) {
  const bytes = readFileSync(path);
  const parsed = JSON.parse(bytes.toString('utf8'));

  if (parsed.report_schema !== 'public-prisma-baseline-comparison-v1') {
    throw new Error(
      'Unsupported report_schema: ' + (parsed.report_schema ?? '<missing>'),
    );
  }
  if (!Array.isArray(parsed.findings)) {
    throw new Error('Comparison report findings must be an array');
  }

  return { parsed, sha256: sha256Bytes(bytes) };
}

function sameFingerprint(a, b) {
  return (a ?? null) === (b ?? null);
}

function disposition(finding) {
  const actualEqualsDeclared = sameFingerprint(
    finding.actual_fingerprint,
    finding.declared_fingerprint,
  );

  if (actualEqualsDeclared) {
    if (finding.classification === 'HISTORY_ONLY') {
      return {
        ratification: 'RATIFIED_RECOVERY_REFERENCE',
        baseline_action: 'EXCLUDE_FROM_NEW_BASELINE',
        reason:
          'ACTUAL and DECLARED both omit this object; frozen recovery reference agrees on absence.',
      };
    }

    return {
      ratification: 'RATIFIED_RECOVERY_REFERENCE',
      baseline_action:
        finding.classification === 'MATCH'
          ? 'KEEP_RECOVERY_REFERENCE'
          : 'BASELINE_TO_RECOVERY_REFERENCE',
      reason:
        'ACTUAL and DECLARED have identical semantic fingerprints; frozen recovery reference agrees.',
    };
  }

  switch (finding.classification) {
    case 'DECLARED_DRIFT':
      return {
        ratification: 'REVIEW_REQUIRED',
        baseline_action: 'HOLD',
        reason:
          'ACTUAL and DECLARED disagree; declaration differs from running recovery reference.',
      };
    case 'DECLARED_ONLY':
      return {
        ratification: 'REVIEW_REQUIRED',
        baseline_action: 'HOLD',
        reason:
          'Declared object is absent from ACTUAL; recovery references disagree.',
      };
    case 'ACTUAL_ONLY':
      return {
        ratification: 'REVIEW_REQUIRED',
        baseline_action: 'HOLD',
        reason:
          'Running object is absent from DECLARED; recovery references disagree.',
      };
    case 'ACTUAL_DRIFT':
      return {
        ratification: 'REVIEW_REQUIRED',
        baseline_action: 'HOLD',
        reason:
          'Running recovery reference differs from DECLARED; environment/runtime parity may be involved.',
      };
    case 'INTENT_REQUIRES_OWNER_DECISION':
      return {
        ratification: 'REVIEW_REQUIRED',
        baseline_action: 'HOLD',
        reason:
          'No recovery-reference agreement exists; owner intent must be resolved explicitly.',
      };
    default:
      return {
        ratification: 'REVIEW_REQUIRED',
        baseline_action: 'HOLD',
        reason:
          'Unexpected disagreement class; fail closed for baseline derivation.',
      };
  }
}

export function ratifyComparison(report) {
  const findings = report.findings.map((finding) => ({
    section: finding.section,
    key: finding.key,
    source_classification: finding.classification,
    ...disposition(finding),
    actual_fingerprint: finding.actual_fingerprint ?? null,
    declared_fingerprint: finding.declared_fingerprint ?? null,
    historical_fingerprint: finding.historical_fingerprint ?? null,
  }));

  const summary = findings.reduce(
    (acc, finding) => {
      acc.total += 1;
      if (finding.ratification === 'RATIFIED_RECOVERY_REFERENCE') {
        acc.ratified += 1;
      } else {
        acc.review_required += 1;
      }
      acc.by_source_classification[finding.source_classification] =
        (acc.by_source_classification[finding.source_classification] ?? 0) + 1;
      acc.by_baseline_action[finding.baseline_action] =
        (acc.by_baseline_action[finding.baseline_action] ?? 0) + 1;
      return acc;
    },
    {
      total: 0,
      ratified: 0,
      review_required: 0,
      by_source_classification: {},
      by_baseline_action: {},
    },
  );

  return {
    ratification_schema: 'public-prisma-baseline-ratification-v1',
    governing_rule:
      'SPATIAL-SCHEMA-OWNERSHIP-01 §0.4: current production + schema.prisma are the recovery reference',
    summary,
    findings,
  };
}

function markdown(ratification, comparisonSha256) {
  const s = ratification.summary;
  const unresolved = ratification.findings.filter(
    (finding) => finding.ratification === 'REVIEW_REQUIRED',
  );

  const lines = [
    '# PUBLIC-PRISMA-BASELINE-RECONCILIATION-01 — Phase C ratification',
    '',
    'Status: **RECOVERY_REFERENCE_RATIFICATION_COMPLETE — BASELINE DDL NOT AUTHORIZED**',
    '',
    'Comparison SHA-256: `' + comparisonSha256 + '`',
    '',
    'Governing frozen rule: `public` is Prisma-owned and current production + `schema.prisma` are the recovery reference.',
    '',
    '## Summary',
    '',
    '| Result | Count |',
    '|---|---:|',
    '| Total findings | ' + s.total + ' |',
    '| Ratified from recovery-reference agreement | ' + s.ratified + ' |',
    '| Review required | ' + s.review_required + ' |',
    '',
    '## Ratification rule',
    '',
    'A finding is mechanically ratified only when ACTUAL and DECLARED have identical semantic fingerprints, including the case where both omit the object.',
    '',
    '- `MATCH` => keep the agreed recovery-reference state.',
    '- `HISTORY_DRIFT` => baseline to the agreed ACTUAL/DECLARED state; historical reconstruction is stale.',
    '- `HISTORY_ONLY` => exclude the historical-only object from the new baseline because both recovery references omit it.',
    '',
    'All findings where ACTUAL and DECLARED disagree remain held for explicit review.',
    '',
    '## Review-required findings',
    '',
    '| Section | Identity | Source class | Reason |',
    '|---|---|---|---|',
    ...unresolved.map(
      (finding) =>
        '| ' +
        finding.section +
        ' | ' +
        String(finding.key).replaceAll('|', '\\|') +
        ' | ' +
        finding.source_classification +
        ' | ' +
        finding.reason +
        ' |',
    ),
    '',
    '## Stop boundary',
    '',
    'This artifact ratifies recovery-reference agreement only. It does not generate baseline SQL, mutate `_prisma_migrations`, delete historical migrations, merge, or promote.',
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
  for (const required of ['comparison', 'out-json', 'out-md']) {
    if (!args[required]) throw new Error('Missing --' + required);
  }
  return args;
}

try {
  const args = parseArgs(process.argv.slice(2));
  const comparison = readComparison(resolve(args.comparison));
  const ratification = ratifyComparison(comparison.parsed);
  ratification.input_comparison_sha256 = comparison.sha256;

  const outJson = resolve(args['out-json']);
  const outMd = resolve(args['out-md']);
  mkdirSync(dirname(outJson), { recursive: true });
  mkdirSync(dirname(outMd), { recursive: true });
  writeFileSync(outJson, JSON.stringify(ratification, null, 2) + '\n', 'utf8');
  writeFileSync(outMd, markdown(ratification, comparison.sha256) + '\n', 'utf8');

  process.stdout.write(
    JSON.stringify({
      status: 'RECOVERY_REFERENCE_RATIFICATION_COMPLETE_NOT_BASELINED',
      input_comparison_sha256: comparison.sha256,
      total: ratification.summary.total,
      ratified: ratification.summary.ratified,
      review_required: ratification.summary.review_required,
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