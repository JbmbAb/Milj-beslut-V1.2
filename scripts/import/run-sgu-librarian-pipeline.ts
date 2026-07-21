/**
 * Run harvest manifest + Librarian import-staging + promote for one SGU ZIP dataset.
 *
 * Usage:
 *   npx tsx scripts/import/run-sgu-librarian-pipeline.ts --id=Jordskred
 */
import { spawnSync } from 'child_process';
import * as path from 'path';

function readArg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : undefined;
}

function run(label: string, args: string[]): void {
  console.log(`\n>>> ${label}`);
  const result = spawnSync('npx', ['tsx', ...args], {
    stdio: 'inherit',
    cwd: process.cwd(),
    env: process.env,
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    throw new Error(`${label} failed (exit ${result.status})`);
  }
}

async function main() {
  const id = readArg('id');
  if (!id) {
    console.error('Usage: npx tsx scripts/import/run-sgu-librarian-pipeline.ts --id=Jordskred');
    process.exit(1);
  }

  const rawDir = path.join('storage', 'manifests', `sgu-${id.toLowerCase()}-zip`, 'raw');
  const planDir = path.join('storage', 'manifests', `sgu-${id.toLowerCase()}-plan`);

  run('Harvest manifest (ZIP verify)', [
    'scripts/import/harvest-sgu-to-master.ts',
    `--only=${id}`,
    '--strategy=zip',
    '--skip-download',
    `--raw-dir=${rawDir}`,
  ]);

  run('Prepare Librarian plan', [
    'scripts/import/prepare-sgu-librarian-plan.ts',
    `--id=${id}`,
    `--raw-dir=${rawDir}`,
  ]);

  run('Librarian import-staging', [
    'scripts/import/import-librarian-manifest.ts',
    '--manifest-dir',
    planDir,
    '--data-dir',
    rawDir,
    '--mode',
    'import-staging',
    '--execute',
  ]);

  run('Librarian promote', [
    'scripts/import/import-librarian-manifest.ts',
    '--manifest-dir',
    planDir,
    '--data-dir',
    rawDir,
    '--mode',
    'promote',
    '--execute',
  ]);

  console.log(`\n✅ SGU ${id} pipeline complete.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
