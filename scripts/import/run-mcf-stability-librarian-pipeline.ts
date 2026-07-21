/**
 * MCF stability: normalize → librarian staging → promote (per category).
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { MASTER_ARCHIVE_ROOT } from './config/mimersBrunn';

const TSX_CLI = path.join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');
const VERSION = process.env.MCF_OUTPUT_VERSION || '2026-06-26';

const CATEGORIES = [
  'finkorniga-jordar',
  'oversiktlig-stabilitetskartering-finkorniga-jordarter',
  'moran-grovkorninga-jordar',
  'oversiktlig-stabilitetskartering-i-moran-och-grova-jordar',
] as const;

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
  });
  if (result.status !== 0) {
    throw new Error(`${label} failed (exit ${result.status})`);
  }
}

function versionDir(category: string): string {
  return path.join(
    MASTER_ARCHIVE_ROOT,
    'Data',
    'MCF',
    'stabilitetskartering-nationell',
    category,
    VERSION,
  );
}

async function main() {
  const only = readArg('category');
  const categories = only
    ? CATEGORIES.filter((c) => c === only)
    : [...CATEGORIES];

  if (!hasFlag('skip-normalize')) {
    for (const category of categories) {
      run(`Normalize ${category}`, [
        'scripts/import/prepare-mcf-stability-national.ts',
        `--category=${category}`,
      ]);
    }
  }

  for (const category of categories) {
    const dir = versionDir(category);
    if (!fs.existsSync(path.join(dir, 'manifest.json'))) {
      console.warn(`SKIP librarian for ${category} — no manifest (normalize produced no layers).`);
      continue;
    }

    run(`Librarian staging ${category}`, [
      'scripts/import/import-librarian-manifest.ts',
      '--manifest-dir',
      dir,
      '--data-dir',
      dir,
      '--mode',
      'import-staging',
      '--execute',
      '--retry-failed',
    ]);

    run(`Librarian promote ${category}`, [
      'scripts/import/import-librarian-manifest.ts',
      '--manifest-dir',
      dir,
      '--data-dir',
      dir,
      '--mode',
      'promote',
      '--execute',
      '--write-back-manifest',
      '--retry-failed',
    ]);
  }

  console.log('\n✅ MCF stability librarian pipeline complete.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
