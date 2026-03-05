#!/usr/bin/env node
import path from 'node:path';
import { copyFileSafe, ensureDir, fileExists, readCsvFile, readJsonFile, timestampSlug, writeJsonFile } from './lib.mjs';
import { INPUT_FILENAMES } from './contracts.mjs';

function parseArgs(argv) {
  const args = argv.slice(2);
  const parsed = {
    from: '../docs/qa/requirements-model',
    out: './input/snapshots',
    label: `snapshot-${timestampSlug()}`,
  };

  for (const arg of args) {
    if (arg.startsWith('--from=')) parsed.from = arg.slice('--from='.length);
    else if (arg.startsWith('--out=')) parsed.out = arg.slice('--out='.length);
    else if (arg.startsWith('--label=')) parsed.label = arg.slice('--label='.length);
  }

  return parsed;
}

async function resolveSourceFile(baseDir, candidates) {
  for (const name of candidates) {
    const full = path.resolve(baseDir, name);
    if (await fileExists(full)) return full;
  }
  return null;
}

async function main() {
  const options = parseArgs(process.argv);
  const sourceDir = path.resolve(process.cwd(), options.from);
  const targetDir = path.resolve(process.cwd(), options.out, options.label);

  const sourceMap = {
    cases: await resolveSourceFile(sourceDir, ['cases.csv', 'requirement_cases.csv']),
    requirements: await resolveSourceFile(sourceDir, ['requirements.csv', 'requirement_rows.csv']),
    citations: await resolveSourceFile(sourceDir, ['citations.csv', 'requirement_citations.csv']),
    summary: await resolveSourceFile(sourceDir, ['summary.json', 'requirement_summary.json']),
  };

  const missing = Object.entries(sourceMap)
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    throw new Error(`Missing source files for: ${missing.join(', ')} in ${sourceDir}`);
  }

  await ensureDir(targetDir);

  const targetFiles = {
    cases: path.join(targetDir, INPUT_FILENAMES.cases),
    requirements: path.join(targetDir, INPUT_FILENAMES.requirements),
    citations: path.join(targetDir, INPUT_FILENAMES.citations),
    summary: path.join(targetDir, INPUT_FILENAMES.summary),
  };

  await copyFileSafe(sourceMap.cases, targetFiles.cases);
  await copyFileSafe(sourceMap.requirements, targetFiles.requirements);
  await copyFileSafe(sourceMap.citations, targetFiles.citations);
  await copyFileSafe(sourceMap.summary, targetFiles.summary);

  const cases = await readCsvFile(targetFiles.cases);
  const requirements = await readCsvFile(targetFiles.requirements);
  const citations = await readCsvFile(targetFiles.citations);
  const summary = await readJsonFile(targetFiles.summary);

  const manifest = {
    importedAt: new Date().toISOString(),
    sourceDir,
    targetDir,
    files: {
      cases: path.basename(targetFiles.cases),
      requirements: path.basename(targetFiles.requirements),
      citations: path.basename(targetFiles.citations),
      summary: path.basename(targetFiles.summary),
    },
    rowCounts: {
      cases: cases.records.length,
      requirements: requirements.records.length,
      citations: citations.records.length,
    },
    summaryTotals: summary?.totals || null,
  };

  await writeJsonFile(path.join(targetDir, 'import_manifest.json'), manifest);

  process.stdout.write(`${JSON.stringify({ ok: true, manifestPath: path.join(targetDir, 'import_manifest.json') })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
