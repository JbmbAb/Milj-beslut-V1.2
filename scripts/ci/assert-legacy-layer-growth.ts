import { glob } from 'glob';
import path from 'path';
import fs from 'fs/promises';

/**
 * This script enforces the architectural decision to stop adding new business logic
 * to the legacy `server/services` and `server/routes` directories.
 *
 * It compares the current files against a checked-in baseline. If new files are
 * detected, the CI check fails. To update the baseline, run
 * `tsx scripts/ci/generate-legacy-baseline.ts` and commit the result.
 */

async function main() {
  console.log('Architectural Guard: Verifying no new files in legacy layers...');

  const baselinePath = path.resolve(process.cwd(), 'scripts/ci/legacy-file-baseline.json');
  const baseline = JSON.parse(await fs.readFile(baselinePath, 'utf-8'));

  const currentServiceFiles = await glob('server/services/**/*.ts', { nodir: true });
  const currentRouteFiles = await glob('server/routes/**/*.ts', { nodir: true });

  const baselineServices = new Set(baseline.services);
  const baselineRoutes = new Set(baseline.routes);

  let hasFailed = false;

  const newServiceFiles = currentServiceFiles.filter((file) => !baselineServices.has(file));
  const newRouteFiles = currentRouteFiles.filter((file) => !baselineRoutes.has(file));

  if (newServiceFiles.length > 0) {
    console.error(`[FAIL] New files detected in legacy 'server/services' directory:`);
    newServiceFiles.forEach((file) => console.error(`  - ${file}`));
    console.error('\nReason: New business logic should be in `src/` or `server/modules/`. See ADR-006.');
    hasFailed = true;
  }

  if (newRouteFiles.length > 0) {
    console.error(`[FAIL] New files detected in legacy 'server/routes' directory:`);
    newRouteFiles.forEach((file) => console.error(`  - ${file}`));
    console.error(
      '\nReason: New routes should be thin adapters. Place new logic in `src/` or `server/modules/`. See ADR-006.',
    );
    hasFailed = true;
  }

  if (hasFailed) {
    console.error(
      '\nIf this change is intentional, update the baseline with `tsx scripts/ci/generate-legacy-baseline.ts` and include it in your commit.',
    );
    process.exit(1);
  }

  console.log('[OK] Legacy layers have not grown. Good job!');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
