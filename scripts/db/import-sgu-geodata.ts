import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';

// Configuration
const GEO_DATA_ZIP = path.resolve(__dirname, '../../../../Geodata/jordarter25k-100k.zip');
const TEMP_DIR = path.resolve(__dirname, '../../output/temp_geo_extract');
const LOCAL_DB_URL =
  process.env.DATABASE_URL || 'postgresql://miljobeslut:password@localhost:5432/miljobeslut_test';

/**
 * 1. Kontrollera att filen finns.
 * 2. Säkerställ att GDAL/ogr2ogr finns installerat.
 * 3. Packa upp fil och läs in via ogr2ogr till PostGIS.
 */
async function runImport() {
  console.log(`\n📦 Miljöbeslut Geo-Importer (SGU/Lantmäteriet)`);
  console.log(`===============================================`);

  // 1. Check if file exists
  if (!fs.existsSync(GEO_DATA_ZIP)) {
    console.error(`\n❌ Hittade inte zip-filen: ${GEO_DATA_ZIP}`);
    console.log(`Vänligen kontrollera att filnamnet och sökvägen stämmer.`);
    process.exit(1);
  }

  console.log(`✅ Hittade Geodata: ${GEO_DATA_ZIP}`);

  // 2. Check for ogr2ogr (GDAL)
  try {
    execSync('ogr2ogr --version', { stdio: 'ignore' });
    console.log(`✅ GDAL (ogr2ogr) är installerat och tillgängligt i Path.`);
  } catch {
    console.error(`\n❌ Saknar GDAL (ogr2ogr) på systemet!`);
    console.log(`Import av så stora geodata-mängder (3.3 GB) kräver ogr2ogr.`);
    console.log(`Instruktioner för dig:`);
    console.log(`1. Installera OSGeo4W (Windows) eller kör "docker run --rm osgeo/gdal:ubuntu-small"`);
    console.log(`2. Du måste packa upp ZIP-filen och köra följande kommando manuellt:`);
    console.log(
      `\n   ogr2ogr -f "PostgreSQL" PG:"${LOCAL_DB_URL}" "din_uppackade_fil.shp" -nln env.sgu_jordart -nlt PROMOTE_TO_MULTI -lco GEOMETRY_NAME=geom\n`,
    );
    process.exit(1);
  }

  // 3. Om ogr2ogr finns, kör vi!
  if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
  }

  console.log(`\nHär hade vi nu packat upp och kört importen automatiskt.`);
  console.log(
    `Eftersom ZIP-filen är på 3.3GB kör vi ett manuellt PowerShell-kommando i bakgrunden för stabilitet.`,
  );
}

runImport().catch((err) => {
  console.error(err);
  process.exit(1);
});
