/**
 * Script to import MSB municipal stability mappings (stabilitetskartering) from downloads.
 * Run: npx dotenv -e .env -- tsx scripts/import/import-stability-mapping.ts
 */
import { spawnSync, execSync } from 'child_process';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

import { PATHS } from './config/mimersBrunn';

dotenv.config();

const prisma = new PrismaClient();
const DATABASE_URL = process.env.DATABASE_URL || '';
const OGR2OGR_PATH = process.env.OGR2OGR_PATH ?? 'C:\\Program Files\\GDAL\\ogr2ogr.exe';
const GEO_INLARNING_DIR = process.env.GEO_INLARNING_DIR ?? path.join(PATHS.DATA, 'MCF'); // Point to harvested MCF data

/** Rekursivt i rot + en nivå undermappar (Lastkaj-kategorier). */
function listZipFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.zip')) {
      results.push(full);
    }
    if (entry.isDirectory()) {
      for (const sub of fs.readdirSync(full, { withFileTypes: true })) {
        if (sub.isFile() && sub.name.toLowerCase().endsWith('.zip')) {
          results.push(path.join(full, sub.name));
        }
      }
    }
  }
  return results;
}

function findShpPathsInZip(zipPath: string, suffix: string): string[] {
  try {
    const listing = execSync(`tar -tf "${zipPath}"`, {
      encoding: 'utf8',
      maxBuffer: 50 * 1024 * 1024,
    });
    return listing
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.toLowerCase().endsWith(`${suffix.toLowerCase()}.shp`));
  } catch {
    return [];
  }
}

function toVsizipShp(zipPath: string, innerPath: string): string {
  const zip = zipPath.replace(/\\/g, '/');
  const inner = innerPath.replace(/\\/g, '/');
  return `/vsizip/${zip}/${inner}`;
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

    const zipFiles = listZipFiles(GEO_INLARNING_DIR);
    const allImports: Array<{ file: string; zonTyp: 1 | 2; kommunName: string }> = [];

    for (const zipPath of zipFiles) {
      for (const zonTyp of [1, 2] as const) {
        const suffix = `_Stabilitetszon${zonTyp}`;
        for (const innerShp of findShpPathsInZip(zipPath, suffix)) {
          const base = path.basename(innerShp, '.shp');
          const kommunName = base.replace(/_Stabilitetszon\d+$/i, '');
          allImports.push({
            file: toVsizipShp(zipPath, innerShp),
            zonTyp,
            kommunName,
          });
        }
      }
    }

    // Legacy: extraherade shapefiles i downloads/
    const legacyDir = path.resolve('downloads');
    for (const suffix of ['_Stabilitetszon1.shp', '_Stabilitetszon2.shp'] as const) {
      const walk = (dir: string): string[] => {
        let hits: string[] = [];
        if (!fs.existsSync(dir)) return hits;
        for (const name of fs.readdirSync(dir)) {
          const full = path.join(dir, name);
          const stat = fs.statSync(full);
          if (stat.isDirectory()) hits = hits.concat(walk(full));
          else if (name.toLowerCase().endsWith(suffix.toLowerCase())) hits.push(full);
        }
        return hits;
      };
      for (const shp of walk(legacyDir)) {
        const zonTyp = suffix.includes('1') ? 1 : 2;
        const fileName = path.basename(shp);
        allImports.push({
          file: shp,
          zonTyp,
          kommunName: fileName.split('_')[0],
        });
      }
    }

    if (allImports.length === 0) {
      console.log(`❌ Inga Stabilitetszon-shapefiles hittades under ${GEO_INLARNING_DIR}.`);
      return;
    }

    console.log(`Hittade ${allImports.length} stabilitetslager att importera.`);

    for (const item of allImports) {
      const { kommunName, zonTyp } = item;
      const stageTable = `stage.tmp_${kommunName.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_stabzon${zonTyp}`;

      console.log(`\n📦 ${kommunName} → zon ${zonTyp}`);
      
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
      console.log(`   ✅ Successfully imported ${kommunName} Stabilitetszon ${zonTyp}`);
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
