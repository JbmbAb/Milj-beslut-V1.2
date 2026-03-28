#!/usr/bin/env node
import path from 'node:path';
import { CASE_HEADERS, CITATION_HEADERS, INPUT_FILENAMES, REQUIREMENT_HEADERS } from './contracts.mjs';
import { ensureDir, normalizeKey, normalizeText, pickFirst, readCsvFile, readJsonFile, timestampSlug, toUpper, writeCsvFile, writeJsonFile } from './lib.mjs';

function parseArgs(argv) {
  const args = argv.slice(2);
  const parsed = {
    snapshot: './input/snapshots/latest',
    out: './working',
    label: `working-${timestampSlug()}`,
  };

  for (const arg of args) {
    if (arg.startsWith('--snapshot=')) parsed.snapshot = arg.slice('--snapshot='.length);
    else if (arg.startsWith('--out=')) parsed.out = arg.slice('--out='.length);
    else if (arg.startsWith('--label=')) parsed.label = arg.slice('--label='.length);
  }

  return parsed;
}

function createHeaderAliasMap(headers) {
  const map = new Map();
  for (const header of headers) {
    map.set(normalizeKey(header), header);
  }
  return map;
}

function mapRecordByHeaders(record, expectedHeaders, aliasMap, report, rowNo, sourceName) {
  const mapped = {};
  for (const header of expectedHeaders) {
    const direct = normalizeText(record[header]);
    if (direct !== '') {
      mapped[header] = direct;
      continue;
    }

    const aliasHeader = aliasMap.get(normalizeKey(header));
    if (aliasHeader) {
      mapped[header] = normalizeText(record[aliasHeader]);
      continue;
    }

    mapped[header] = '';
    report.missingCells.push({ source: sourceName, rowNo, header });
  }
  return mapped;
}

async function main() {
  const options = parseArgs(process.argv);
  const snapshotDir = path.resolve(process.cwd(), options.snapshot);
  const outputDir = path.resolve(process.cwd(), options.out, options.label);

  const sourcePaths = {
    cases: path.join(snapshotDir, INPUT_FILENAMES.cases),
    requirements: path.join(snapshotDir, INPUT_FILENAMES.requirements),
    citations: path.join(snapshotDir, INPUT_FILENAMES.citations),
    summary: path.join(snapshotDir, INPUT_FILENAMES.summary),
  };

  const [cases, requirements, citations, summary] = await Promise.all([
    readCsvFile(sourcePaths.cases),
    readCsvFile(sourcePaths.requirements),
    readCsvFile(sourcePaths.citations),
    readJsonFile(sourcePaths.summary),
  ]);

  const report = {
    generatedAt: new Date().toISOString(),
    snapshotDir,
    outputDir,
    missingCells: [],
    counters: {},
  };

  const casesAlias = createHeaderAliasMap(cases.headers);
  const requirementsAlias = createHeaderAliasMap(requirements.headers);
  const citationsAlias = createHeaderAliasMap(citations.headers);

  const normalizedCases = cases.records.map((record, idx) =>
    mapRecordByHeaders(record, CASE_HEADERS, casesAlias, report, idx + 2, 'cases.csv')
  );

  const normalizedRequirements = requirements.records.map((record, idx) => {
    const row = mapRecordByHeaders(record, REQUIREMENT_HEADERS, requirementsAlias, report, idx + 2, 'requirements.csv');
    const status = toUpper(row.Verifieringsstatus || pickFirst(record, ['verificationStatus', 'VerificationStatus']));
    if (status) {
      row.Verifieringsstatus = status;
    } else if (toUpper(row.VerifieradJaNej) === 'JA') {
      row.Verifieringsstatus = 'VERIFIED';
    } else {
      row.Verifieringsstatus = 'AUTO';
    }
    return row;
  });

  const normalizedCitations = citations.records.map((record, idx) =>
    mapRecordByHeaders(record, CITATION_HEADERS, citationsAlias, report, idx + 2, 'citations.csv')
  );

  report.counters = {
    cases: normalizedCases.length,
    requirements: normalizedRequirements.length,
    citations: normalizedCitations.length,
    missingCellCount: report.missingCells.length,
  };

  await ensureDir(outputDir);
  await Promise.all([
    writeCsvFile(path.join(outputDir, INPUT_FILENAMES.cases), CASE_HEADERS, normalizedCases),
    writeCsvFile(path.join(outputDir, INPUT_FILENAMES.requirements), REQUIREMENT_HEADERS, normalizedRequirements),
    writeCsvFile(path.join(outputDir, INPUT_FILENAMES.citations), CITATION_HEADERS, normalizedCitations),
    writeJsonFile(path.join(outputDir, INPUT_FILENAMES.summary), summary),
    writeJsonFile(path.join(outputDir, 'normalization_report.json'), report),
  ]);

  process.stdout.write(`${JSON.stringify({ ok: true, outputDir, counters: report.counters })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
