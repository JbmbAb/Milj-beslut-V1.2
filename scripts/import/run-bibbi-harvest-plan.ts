/**
 * Bibbi harvest plan — inventory-first scheduling for SGU (Mimers Brunn).
 *
 * Usage:
 *   npx tsx scripts/import/run-bibbi-harvest-plan.ts
 *   npx tsx scripts/import/run-bibbi-harvest-plan.ts --only=Brunnar,Grundvatten
 *   npx tsx scripts/import/run-bibbi-harvest-plan.ts --execute
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import { buildSguCatalog, buildSguInventory } from './bibbi/sguCatalog';
import { planHarvestSchedule } from './bibbi/planHarvestSchedule';
import type { HarvestPlanItem } from './bibbi/types';

const TSX_CLI = path.join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');

function readArg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function runHarvest(item: HarvestPlanItem): void {
  if (item.action === 'SKIP') return;

  const args = [TSX_CLI, 'scripts/import/harvest-sgu-to-master.ts', `--only=${item.datasetId}`, '--strategy=zip'];

  const canSkipDownload =
    Boolean(item.rawDir) &&
    (item.action === 'REHARVEST' ||
      (item.action === 'RESUME' && fs.existsSync(path.join(item.rawDir!, 'manifest.json'))));

  if (canSkipDownload) {
    args.push('--skip-download', `--raw-dir=${item.rawDir}`);
  }

  console.log(`\n>>> ${item.action} SGU/${item.datasetId}`);
  if (item.rawDir) console.log(`    raw-dir: ${item.rawDir}`);

  const result = spawnSync(process.execPath, args, {
    stdio: 'inherit',
    cwd: process.cwd(),
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(`${item.action} ${item.datasetId} failed (exit ${result.status})`);
  }
}

function main(): void {
  const onlyRaw = readArg('only');
  const onlyIds = onlyRaw ? onlyRaw.split(',').map((s) => s.trim()).filter(Boolean) : undefined;
  const execute = hasFlag('execute');

  console.log('=== Bibbi Harvest Plan (inventory-first) ===');
  if (!execute) console.log('Dry-run — add --execute to run harvest scripts.\n');

  const catalog = buildSguCatalog(onlyIds);
  const inventory = buildSguInventory(onlyIds);
  const plan = planHarvestSchedule(inventory, catalog);

  console.log(
    `Plan: SKIP=${plan.summary.skip} RESUME=${plan.summary.resume} REHARVEST=${plan.summary.reharvest} DOWNLOAD=${plan.summary.download}\n`,
  );

  for (const item of plan.items) {
    const flag = item.action === 'SKIP' ? '⏭️' : item.action === 'RESUME' ? '⏸️' : '📥';
    console.log(
      `${flag} [T${item.tier}] ${item.priorityRank + 1}. ${item.provider}/${item.datasetId} → ${item.action} — ${item.reason}`,
    );
  }

  if (!execute) {
    console.log('\nIngen harvest kördes (dry-run).');
    return;
  }

  console.log('\n=== Executing harvest plan ===');
  for (const item of plan.items) {
    if (item.action === 'SKIP') continue;
    runHarvest(item);
  }
  console.log('\n✅ Bibbi harvest plan complete.');
}

main();
