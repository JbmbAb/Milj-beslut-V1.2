/**
 * import-raster-data.ts  (entrypoint-wrapper)
 *
 * Vidarebefordrar till det modulära skriptet under scripts/import/.
 * Den faktiska implementationen finns i:
 *   scripts/import/import-raster-outdb.ts
 *
 * Användning:
 *   npx tsx import-raster-data.ts --status
 *   npx tsx import-raster-data.ts --provider=SGU --dataset=Jordarter_25k --dry-run
 *   npx tsx import-raster-data.ts --all
 */

// Läs in env-filen (dotenv) innan vi delegerar till det modulära skriptet
import dotenv from 'dotenv';
dotenv.config();

// Delegation — kör import-raster-outdb som en subprocess med samma argument
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const script = path.join(__dirname, 'scripts', 'import', 'import-raster-outdb.ts');
const tsx    = path.join(__dirname, 'node_modules', 'tsx', 'dist', 'cli.mjs');

const result = spawnSync(
  process.execPath,
  [tsx, script, ...process.argv.slice(2)],
  { stdio: 'inherit' },
);

process.exit(result.status ?? 0);
