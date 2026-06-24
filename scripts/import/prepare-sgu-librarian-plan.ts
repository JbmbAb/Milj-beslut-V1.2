/**
 * Prepare a local Librarian plan directory (C:) from a harvested SGU ZIP bundle.
 *
 * Usage:
 *   npx tsx scripts/import/prepare-sgu-librarian-plan.ts --id=Jordarter25k100k
 *   npx tsx scripts/import/prepare-sgu-librarian-plan.ts --raw-dir=storage/manifests/sgu-jordart-zip/raw
 */
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';
import { getSguHarvestSource } from './config/sguHarvestSources';

dotenv.config();

function readArg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : undefined;
}

async function main() {
  const id = readArg('id') ?? 'Jordarter25k100k';
  const source = getSguHarvestSource(id);
  if (!source?.zip) {
    console.error(`No ZIP source for id=${id}`);
    process.exit(1);
  }

  const rawDir = path.resolve(
    readArg('raw-dir') ?? path.join(process.cwd(), 'storage', 'manifests', 'sgu-jordart-zip', 'raw'),
  );
  const harvestManifest = path.join(rawDir, 'manifest.json');
  const gpkgPath = path.join(rawDir, 'extracted', source.zip.innerGpkg);

  if (!fs.existsSync(harvestManifest)) {
    console.error(`Harvest manifest missing: ${harvestManifest}`);
    console.error(
      'Run: npx tsx scripts/import/harvest-sgu-to-master.ts --only=Jordarter25k100k --strategy=zip --skip-download --raw-dir=<raw>',
    );
    process.exit(1);
  }

  if (!fs.existsSync(gpkgPath)) {
    console.error(`GPKG not found: ${gpkgPath}`);
    process.exit(1);
  }

  const planDir = path.join(process.cwd(), 'storage', 'manifests', `sgu-${id.toLowerCase()}-plan`);
  fs.mkdirSync(planDir, { recursive: true });

  const manifest = JSON.parse(fs.readFileSync(harvestManifest, 'utf8')) as Record<string, unknown>;
  fs.writeFileSync(path.join(planDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  console.log('\n=== Librarian plan ready ===');
  console.log(`Plan dir:      ${planDir}`);
  console.log(`Data dir:      ${rawDir}`);
  console.log(`Bundle SHA256: ${manifest.content_bundle_sha256}`);
  console.log(`GPKG layer:    ${source.zip.ogrLayer} (${source.zip.expectedFeatureCount?.toLocaleString('sv-SE')} rows)`);
  console.log('\nNext steps:');
  console.log(`  npx tsx scripts/import/import-librarian-manifest.ts --manifest-dir "${planDir}" --data-dir "${rawDir}" --mode plan`);
  console.log(`  npx tsx scripts/import/import-librarian-manifest.ts --manifest-dir "${planDir}" --data-dir "${rawDir}" --mode import-staging --execute`);
  console.log(`  npx tsx scripts/import/import-librarian-manifest.ts --manifest-dir "${planDir}" --data-dir "${rawDir}" --mode promote --execute`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
