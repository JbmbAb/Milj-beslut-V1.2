/**
 * STAC national merge → Librarian staging → promote for one LM dataset.
 *
 * Usage:
 *   npx tsx scripts/import/run-lm-stac-librarian-pipeline.ts --dataset="Fastighetsindelning_Nationell/Registerenhetsomradeslinjer"
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { MASTER_ARCHIVE_ROOT } from './config/mimersBrunn';
import { resolveStacMergeEntryByDataset } from './config/importRegistry';

const TSX_CLI = path.join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');

function readArg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : undefined;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(`--${flag}`);
}

function run(label: string, args: string[]): void {
  console.log(`\n>>> ${label}`);
  const result = spawnSync(process.execPath, [TSX_CLI, ...args], {
    stdio: 'inherit',
    cwd: process.cwd(),
    env: process.env,
    shell: false,
  });
  if (result.status !== 0) {
    throw new Error(`${label} failed (exit ${result.status})`);
  }
}

function assertManifestQaStatus(versionDir: string, expected: string, label: string): void {
  const manifestPath = path.join(versionDir, 'manifest.json');
  const raw = fs.readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(raw) as { qa_status?: string; qa_error?: string };
  const actual = manifest.qa_status ?? 'pending';
  if (actual !== expected) {
    const suffix = manifest.qa_error ? `: ${manifest.qa_error}` : '';
    throw new Error(`${label} did not reach qa_status=${expected}; got ${actual}${suffix} (${manifestPath})`);
  }
}

async function main() {
  const dataset = readArg('dataset');
  const version = readArg('version') ?? new Date().toISOString().slice(0, 10);
  if (!dataset) {
    console.error(
      'Usage: npx tsx scripts/import/run-lm-stac-librarian-pipeline.ts --dataset="Fastighetsindelning_Nationell/Registerenhetsomradeslinjer"',
    );
    process.exit(1);
  }

  const match = resolveStacMergeEntryByDataset(dataset);
  if (!match) {
    throw new Error(`No STAC merge profile for dataset "${dataset}"`);
  }

  const versionDir = path.join(MASTER_ARCHIVE_ROOT, 'Data', match.provider, dataset, version);

  if (!hasFlag('skip-merge')) {
    run('STAC national merge', [
      'scripts/import/merge-stac-national.ts',
      '--dataset',
      dataset,
      '--version',
      version,
      '--execute',
      '--resume',
    ]);
  } else {
    console.log('\n>>> STAC national merge (skipped — --skip-merge)');
  }

  run('Librarian import-staging', [
    'scripts/import/import-librarian-manifest.ts',
    '--manifest-dir',
    versionDir,
    '--data-dir',
    versionDir,
    '--mode',
    'import-staging',
    '--execute',
  ]);
  assertManifestQaStatus(versionDir, 'staging_ok', 'Librarian import-staging');

  run('Librarian promote', [
    'scripts/import/import-librarian-manifest.ts',
    '--manifest-dir',
    versionDir,
    '--data-dir',
    versionDir,
    '--mode',
    'promote',
    '--execute',
    '--write-back-manifest',
  ]);
  assertManifestQaStatus(versionDir, 'passed', 'Librarian promote');

  console.log(`\n✅ LM STAC ${dataset} pipeline complete.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
