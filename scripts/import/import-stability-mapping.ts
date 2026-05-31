/**
 * Script to import MSB municipal stability mappings (stabilitetskartering) from downloads.
 * Run: npx dotenv -e .env -- tsx scripts/import/import-stability-mapping.ts
 */
import { spawnSync } from 'child_process';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

dotenv.config();

const prisma = new PrismaClient();
const DATABASE_URL = process.env.DATABASE_URL || '';
const OGR2OGR_PATH = 'C:\\Program Files\\GDAL\\ogr2ogr.exe';
const DOWNLOADS_DIR = path.resolve('downloads');

// Helper to recursively find files matching a suffix
function findFiles(dir: string, suffix: string): string[] {
  let results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat && stat.isDirectory()) {
      results = results.concat(findFiles(filePath, suffix));
    } else if (file.toLowerCase().endsWith(suffix.toLowerCase())) {
      results.push(filePath);
    }
  }
  return results;
}

async function runImport() {
  console.log(`\n🚀 IMPORTING MUNICIPAL STABILITY MAPPINGS (MSB)`);
  console.log(`=================================================`);

  const url = new URL(DATABASE_URL);
  const dbname = url.pathname.slice(1);
  const host = url.hostname;
  const user = url.username;
  const password = url.password;
  const port = url.port || '5432';
  const pgConn = `PG:dbname='${dbname}' host='${host}' user='${user}' password='${password}' port='${port}'`;

  try {
    // 1. Ensure schemas and production table exist
    await prisma.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS stage;`);
    await prisma.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS env;`);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS env.msb_stabilitetszon (
        id SERIAL PRIMARY KEY,
        kommun_namn TEXT,
        zon_typ INTEGER, -- 1 for unsatisfactory, 2 for uncertain
        geom GEOMETRY(MULTIPOLYGON, 3006)
      );
    `);

    // We can clear old imports from Orsa to avoid duplicates during testing
    await prisma.$executeRawUnsafe(`DELETE FROM env.msb_stabilitetszon WHERE kommun_namn = 'Orsa';`);

    // 2. Find all Stabilitetszon shapefiles in downloads
    const shpFiles1 = findFiles(DOWNLOADS_DIR, '_Stabilitetszon1.shp');
    const shpFiles2 = findFiles(DOWNLOADS_DIR, '_Stabilitetszon2.shp');

    const allImports = [
      ...shpFiles1.map(file => ({ file, zonTyp: 1 })),
      ...shpFiles2.map(file => ({ file, zonTyp: 2 }))
    ];

    if (allImports.length === 0) {
      console.log(`❌ No stability shapefiles (*_Stabilitetszon1.shp or *_Stabilitetszon2.shp) found in ${DOWNLOADS_DIR}.`);
      console.log(`   Please make sure to extract municipal ZIPs under ${DOWNLOADS_DIR}.`);
      return;
    }

    for (const item of allImports) {
      const fileName = path.basename(item.file);
      // Extract municipality name from file, e.g. "Orsa_Stabilitetszon1.shp" -> "Orsa"
      const kommunName = fileName.split('_')[0];
      const stageTable = `stage.tmp_${kommunName.toLowerCase()}_stabzon${item.zonTyp}`;

      console.log(`\n📦 Found: ${fileName} (${kommunName}) -> Target: Zon ${item.zonTyp}`);
      
      // Clean up previous temp table
      await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS ${stageTable} CASCADE;`);

      // Run ogr2ogr to load shapefile into temp table
      const args = [
        '-f', 'PostgreSQL',
        pgConn,
        item.file,
        '-nln', stageTable,
        '-overwrite',
        '-nlt', 'PROMOTE_TO_MULTI',
        '-lco', 'GEOMETRY_NAME=geom',
        '-t_srs', 'EPSG:3006'
      ];

      console.log(`   - Executing ogr2ogr to temp table ${stageTable}...`);
      const result = spawnSync(OGR2OGR_PATH, args, { stdio: 'inherit' });
      
      if (result.status !== 0) {
        console.error(`   ❌ Failed to load shapefile via ogr2ogr.`);
        continue;
      }

      // Copy from temp table to production table
      console.log(`   - Transferring data to env.msb_stabilitetszon...`);
      await prisma.$executeRawUnsafe(`
        INSERT INTO env.msb_stabilitetszon (kommun_namn, zon_typ, geom)
        SELECT '${kommunName}', ${item.zonTyp}, ST_Multi(ST_SetSRID(geom, 3006))
        FROM ${stageTable};
      `);

      // Clean up temp table
      await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS ${stageTable} CASCADE;`);
      console.log(`   ✅ Successfully imported ${kommunName} Stabilitetszon ${item.zonTyp}`);
    }

    // 3. Create spatial index
    console.log(`\n🔍 Building spatial index...`);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS msb_stabilitetszon_geom_idx ON env.msb_stabilitetszon USING GIST (geom);
    `);
    await prisma.$executeRawUnsafe(`VACUUM ANALYZE env.msb_stabilitetszon;`);
    
    console.log(`\n🎉 IMPORT FINISHED.`);
  } catch (err) {
    console.error(`❌ Critical error during import:`, err);
  } finally {
    await prisma.$disconnect();
  }
}

runImport();
