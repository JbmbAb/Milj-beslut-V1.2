/**
 * Laddar ner miljö-/logistikrelevanta datapaket från Lastkajen till storage/ingest/lastkajen/.
 * Länsvisa paket (10147–10166) utelämnas – samma NVDB-data finns i rikspaket.
 *
 * PostGIS-import av utvalda lager (ATK, trafikplats, vilt 10094, ISA): se
 * scripts/import/import-lastkajen-relevant.ts och server/datasources/lastkajenLayerCatalog.ts.
 *
 * Arkiv-only (nedladdas men importeras inte till PostGIS):
 * - 10175 vilt historik (legacy shapefile/raster, ej GeoPackage-hotspots)
 * - 10125 vägbeläggning och 10085 drift kan importeras separat vid behov
 *
 * Run: npx dotenv -e .env -- tsx scripts/import/lastkajen-download-relevant.ts
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { stat } from 'node:fs/promises';
import dotenv from 'dotenv';
import {
  downloadDataPackageFileToPath,
  listDataPackageFiles,
  listPublishedDataPackages,
} from '../../server/services/lastkajenService';

dotenv.config();

/** Paket-ID som är relevanta för miljöbeslut, transport, buller, vilt, barriärer. */
export const RELEVANT_PACKAGE_IDS = new Set([
  10139, // ATK
  10124, // Cykelvägnät
  10125, // Vägbeläggning
  10085, // Drift och underhåll
  5052, // ISA hastighet
  10140, // Rastplats
  10092, // Trafikplats väg
  10094, // Viltolyckskartor väg (aktuella hotspots → PostGIS)
  10175, // Vilt historik – arkiv-only (legacy shp/raster, skipImport i manifest)
  10084, // Vägdata för transportplanering
  10093, // Vägnummer
  10143, // Järnvägsnät aggregerade bandelar
  10144, // Järnvägsnät grundegenskaper
  10145, // Järnvägsnät längdmätning
  10091, // Trafikplats järnväg
  10088, // Noise (buller)
  10095, // Railway transport network (INSPIRE)
  10096, // Road transport network (INSPIRE)
  10089, // Water transport network
  10142, // Tillgänglighetsvägnät
  10169, // Trafiknätsdata blåljus
  10499, // Barriärkartor – tidigare årsserier
  10177, // Barriärkartor
  10178, // Viltolyckskartor järnväg
  10179, // Viltolyckskartor järnväg – tidigare
  10180, // Sverigefiler utvalda NVDB-data
  10181, // Höjddata statligt vägnät
  10472, // Vägtrummor punkter
  10473, // Vägtrummor linjer
  10497, // Vägar utan länsvis tillstånd virkesupplag
  10498, // Blåljusnavigering
]);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ingestRoot = path.join(repoRoot, 'storage/ingest/lastkajen');

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const info = await stat(filePath);
    return info.isFile() && info.size > 0;
  } catch {
    return false;
  }
}

async function main() {
  const published = await listPublishedDataPackages();
  const targets = published.filter((p) => RELEVANT_PACKAGE_IDS.has(p.id));

  console.log(`\nLastkajen batch: ${targets.length} relevanta paket av ${published.length} publicerade\n`);

  let downloaded = 0;
  let skipped = 0;
  let failed = 0;

  for (const pkg of targets) {
    console.log(`\n=== ${pkg.id}: ${pkg.name} ===`);
    let files;
    try {
      files = await listDataPackageFiles(pkg.id);
    } catch (error: unknown) {
      console.error(`  Kunde inte lista filer: ${error instanceof Error ? error.message : error}`);
      failed += 1;
      continue;
    }

    const fileEntries = files.filter((f) => !f.isFolder && f.name?.trim());
    if (fileEntries.length === 0) {
      console.log('  (inga filer i paketlistan)');
      continue;
    }

    for (const file of fileEntries) {
      const safeName = path.basename(file.name);
      const destination = path.join(ingestRoot, String(pkg.id), safeName);

      if (await fileExists(destination)) {
        console.log(`  SKIP ${safeName} (finns redan)`);
        skipped += 1;
        continue;
      }

      try {
        console.log(`  Hämtar ${safeName} (${file.size ?? '?'})…`);
        const result = await downloadDataPackageFileToPath(pkg.id, safeName, destination);
        console.log(`  OK ${safeName} → ${result.bytesWritten} bytes`);
        downloaded += 1;
      } catch (error: unknown) {
        console.error(`  FAIL ${safeName}: ${error instanceof Error ? error.message : error}`);
        failed += 1;
      }
    }
  }

  console.log(`\nKlart. Nedladdade: ${downloaded}, hoppade över: ${skipped}, misslyckade: ${failed}`);
  console.log(`Målmapp: ${ingestRoot}\n`);

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
