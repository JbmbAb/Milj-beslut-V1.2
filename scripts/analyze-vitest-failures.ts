/**
 * scripts/analyze-vitest-failures.ts
 *
 * Läser .tmp-vitest-unit.json (Vitest JSON-reporter-output) och producerar
 * en grupperad rapport över fallerande tester per domän.
 *
 * Kategoriseras via testfilens sökväg:
 *  - gis       → *gis*, *geo*, *map*, *spatial*
 *  - legal     → *legal*, *judgment*, *knowledge*, *requirement*
 *  - ingest    → *ingest*, *scheduler*, *outlook*, *lims*, *domstol*
 *  - property  → *property*, *lantmateri*
 *  - övrigt
 *
 * Skriver en markdown-rapport till docs/qa/vitest-backlog.md.
 */

import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';

interface AssertionResult {
  fullName?: string;
  title?: string;
  status: string;
  failureMessages?: string[];
}

interface TestFileResult {
  name: string;
  status: string;
  assertionResults?: AssertionResult[];
  message?: string;
}

interface VitestReport {
  numFailedTests: number;
  numFailedTestSuites: number;
  numTotalTests: number;
  numPassedTests: number;
  testResults: TestFileResult[];
}

type Domain = 'gis' | 'legal' | 'ingest' | 'property' | 'other';

function classify(filePath: string): Domain {
  const low = filePath.toLowerCase();
  if (/gis|geo|\bmap|spatial|markcover|nvr|sgu|terrain|smhi/.test(low)) return 'gis';
  if (/legal|judgment|knowledge|requirement|citation/.test(low)) return 'legal';
  if (/ingest|scheduler|outlook|lims|domstol|pipeline/.test(low)) return 'ingest';
  if (/property|lantmateri/.test(low)) return 'property';
  return 'other';
}

function extractFailingTests(report: VitestReport): Record<
  Domain,
  Array<{
    file: string;
    tests: Array<{ name: string; message: string }>;
  }>
> {
  const grouped: Record<Domain, Array<{ file: string; tests: Array<{ name: string; message: string }> }>> = {
    gis: [],
    legal: [],
    ingest: [],
    property: [],
    other: [],
  };

  for (const fileResult of report.testResults ?? []) {
    const fails = (fileResult.assertionResults ?? []).filter((a) => a.status === 'failed');
    if (fails.length === 0 && fileResult.status !== 'failed') continue;

    const relativePath = relative(process.cwd(), fileResult.name).replace(/\\/g, '/');
    const domain = classify(relativePath);

    const tests = fails.map((f) => ({
      name: f.fullName || f.title || '(ej namn)',
      message: (f.failureMessages ?? ['(inget felmeddelande)'])[0]?.split('\n').slice(0, 2).join(' | ') ?? '',
    }));

    if (tests.length === 0 && fileResult.message) {
      tests.push({ name: '(suite-setup)', message: fileResult.message.split('\n')[0] });
    }

    grouped[domain].push({ file: relativePath, tests });
  }

  return grouped;
}

function formatMarkdown(grouped: ReturnType<typeof extractFailingTests>, report: VitestReport): string {
  const lines: string[] = [];
  lines.push('# Vitest failure-backlog');
  lines.push('');
  lines.push(`Genererad: ${new Date().toISOString()}`);
  lines.push('');
  lines.push(
    `Totalt: ${report.numTotalTests} tester, ${report.numPassedTests} passed, ${report.numFailedTests} failed (${report.numFailedTestSuites} failade suiter).`,
  );
  lines.push('');

  const domainOrder: Domain[] = ['gis', 'legal', 'ingest', 'property', 'other'];
  const domainLabels: Record<Domain, string> = {
    gis: 'GIS / kartlager / spatial',
    legal: 'Juridik / krav / kunskapsgraf',
    ingest: 'Ingest / schemaläggning / pipelines',
    property: 'Fastighetsuppslag / Lantmäteriet',
    other: 'Övrigt',
  };

  for (const domain of domainOrder) {
    const items = grouped[domain];
    if (items.length === 0) continue;
    const failCount = items.reduce((sum, i) => sum + i.tests.length, 0);
    lines.push(`## ${domainLabels[domain]}  (${items.length} filer / ${failCount} tester)`);
    lines.push('');
    for (const { file, tests } of items) {
      lines.push(`- \`${file}\` — ${tests.length} fail`);
      for (const t of tests.slice(0, 5)) {
        lines.push(`  - ${t.name}`);
        lines.push(`    - ${t.message.replace(/\r?\n/g, ' ').slice(0, 200)}`);
      }
      if (tests.length > 5) {
        lines.push(`  - … och ${tests.length - 5} till`);
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}

function main(): void {
  const inputPath = process.argv[2] ?? '.tmp-vitest-unit.json';
  const outputPath = process.argv[3] ?? 'docs/qa/vitest-backlog.md';
  const resolvedIn = resolve(process.cwd(), inputPath);
  const resolvedOut = resolve(process.cwd(), outputPath);

  const raw = readFileSync(resolvedIn, 'utf8');
  const report = JSON.parse(raw) as VitestReport;

  const grouped = extractFailingTests(report);
  const md = formatMarkdown(grouped, report);

  mkdirSync(dirname(resolvedOut), { recursive: true });
  writeFileSync(resolvedOut, md);

  const countByDomain = Object.fromEntries(
    Object.entries(grouped).map(([d, arr]) => [d, arr.reduce((sum, item) => sum + item.tests.length, 0)]),
  );
  console.log(`Skrev ${resolvedOut} — ${report.numFailedTests} fail fördelade på:`, countByDomain);
}

main();
