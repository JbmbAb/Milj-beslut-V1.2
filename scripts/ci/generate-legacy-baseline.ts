import { glob } from 'glob';
import fs from 'fs/promises';
import path from 'path';

/**
 * This script generates a baseline of current files in the legacy server/services
 * and server/routes directories. The output is used by the
 * `assert-legacy-layer-growth.ts` CI check to prevent new files from being added.
 *
 * Run this script only when you intentionally want to update the baseline.
 */
async function main() {
  console.log('Generating legacy file baseline...');

  const serviceFiles = await glob('server/services/**/*.ts', { nodir: true });
  const routeFiles = await glob('server/routes/**/*.ts', { nodir: true });

  const baseline = {
    services: serviceFiles.sort(),
    routes: routeFiles.sort(),
  };

  const baselinePath = path.resolve(process.cwd(), 'scripts/ci/legacy-file-baseline.json');
  await fs.writeFile(baselinePath, JSON.stringify(baseline, null, 2));

  console.log(`[OK] Baseline written to ${baselinePath}`);
  console.log(`- Services: ${baseline.services.length} files`);
  console.log(`- Routes: ${baseline.routes.length} files`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});