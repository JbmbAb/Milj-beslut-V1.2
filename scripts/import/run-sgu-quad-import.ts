import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import dotenv from 'dotenv';

dotenv.config();

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
  const targetIds = ['Kallor', 'Borrhal', 'Grundvattenforekomster', 'MaringeologiYtsubstrat'];
  const archiveRoot = process.env.MASTER_ARCHIVE_ROOT || 'H:\\Delade enheter\\Miljöbeslut\\GEO_Master_Archive';

  console.log('=== Starting SGU Quad PostGIS Ingestion Pipeline ===');

  for (const id of targetIds) {
    console.log(`\n--------------------------------------------------`);
    console.log(`Processing ingestion for SGU: ${id}`);
    console.log(`--------------------------------------------------`);

    const datasetDir = path.join(archiveRoot, 'Data', 'SGU', id);
    if (!fs.existsSync(datasetDir)) {
      console.error(`Error: Dataset directory not found: ${datasetDir}`);
      continue;
    }

    // Hitta den senaste tidstämplade mappen
    const folders = fs.readdirSync(datasetDir)
      .map(name => ({ name, fullPath: path.join(datasetDir, name) }))
      .filter(f => fs.statSync(f.fullPath).isDirectory() && !f.name.startsWith('.'));

    if (folders.length === 0) {
      console.error(`Error: No harvested versions found in ${datasetDir}`);
      continue;
    }

    // Sortera efter namn (eftersom det är tidsstämplade YYYY-MM-DD_HHmm eller liknande) för att få den nyaste
    folders.sort((a, b) => b.name.localeCompare(a.name));
    const latestFolder = folders[0]!;
    const rawDir = path.join(latestFolder.fullPath, 'raw');

    console.log(`Using latest harvested version: ${latestFolder.name}`);
    console.log(`Raw directory path: ${rawDir}`);

    const manifestFile = path.join(rawDir, 'manifest.json');
    if (!fs.existsSync(manifestFile)) {
      console.error(`Error: manifest.json missing in ${rawDir}`);
      continue;
    }

    // Skapa plan-katalog lokalt
    const planDir = path.join(process.cwd(), 'storage', 'manifests', `sgu-${id.toLowerCase()}-plan`);
    if (!fs.existsSync(planDir)) {
      fs.mkdirSync(planDir, { recursive: true });
    }

    // Kopiera manifest.json till plan-katalogen
    fs.copyFileSync(manifestFile, path.join(planDir, 'manifest.json'));
    console.log(`Prepared plan manifest in ${planDir}`);

    // Kör import till staging
    run(`Librarian import-staging [${id}]`, [
      'scripts/import/import-librarian-manifest.ts',
      '--manifest-dir', planDir,
      '--data-dir', rawDir,
      '--mode', 'import-staging',
      '--execute'
    ]);

    // Kör promotion till produktion och bygg index
    run(`Librarian promote [${id}]`, [
      'scripts/import/import-librarian-manifest.ts',
      '--manifest-dir', planDir,
      '--data-dir', rawDir,
      '--mode', 'promote',
      '--execute'
    ]);

    console.log(`\n✅ Ingestion complete for SGU: ${id}`);
  }

  console.log('\n=== All Four SGU Datasets Promoted To Production ===');
}

main().catch(console.error);
