/**
 * Lista publicerade datapaket i Lastkajen (Trafikverket).
 *
 * Kräver i .env:
 *   LASTKAJEN_USERNAME=
 *   LASTKAJEN_PASSWORD=
 *
 * Run: npx dotenv -e .env -- tsx scripts/import/lastkajen-list-packages.ts
 */
import dotenv from 'dotenv';
import {
  listDataPackageFiles,
  listPublishedDataPackages,
} from '../../server/services/lastkajenService';

dotenv.config();

async function main() {
  const packages = await listPublishedDataPackages();
  console.log(`\nLastkajen: ${packages.length} publicerade datapaket\n`);

  for (const pkg of packages) {
    console.log(`— ${pkg.id}: ${pkg.name}`);
    if (pkg.description) console.log(`  ${pkg.description}`);
    if (pkg.targetFolder?.path) console.log(`  Mapp: ${pkg.targetFolder.path}`);

    const showFiles = process.argv.includes('--files');
    if (showFiles) {
      const files = await listDataPackageFiles(pkg.id);
      for (const file of files) {
        if (file.isFolder) continue;
        console.log(`    • ${file.name} (${file.size ?? '?'})`);
      }
    }
  }

  if (!process.argv.includes('--files')) {
    console.log('\nTips: lägg till --files för att lista filer per paket.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
