/**
 * @deprecated Sunset 2026-09-01 — use import-librarian-manifest.ts only.
 * See docs/architecture/import-librarian-only-policy.md
 */
import { execSync } from 'child_process';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();
const DATABASE_URL = process.env.DATABASE_URL || '';
const OGR2OGR_PATH = 'C:\\Program Files\\GDAL\\ogr2ogr.exe';

const SGU_COLLECTIONS = [
  { id: 'ground_1m', url: 'https://api.sgu.se/oppnadata/jordarter1miljon/ogc/features/v1/collections/grundlager', table: 'env.sgu_ground_layer_1m' },
  { id: 'landslide', url: 'https://api.sgu.se/oppnadata/jordskred-raviner/ogc/features/v1/collections/jordskred-raviner', table: 'env.sgu_landslide_feature' },
  { id: 'soil_25k_100k', url: 'https://api.sgu.se/oppnadata/jordarter25k-100k/ogc/features/v1/collections/grundlager', table: 'env.sgu_soil_type_25k_100k' },
  { id: 'groundwater', url: 'https://api.sgu.se/oppnadata/grundvattenmagasin/ogc/features/v1/collections/grundvattenmagasin', table: 'env.env_sgu_grundvatten_sarbarhet' },
  { id: 'wells', url: 'https://api.sgu.se/oppnadata/brunnar/ogc/features/v1/collections/brunnar', table: 'env.sgu_well' },
  { id: 'aktsam_efterarbetad', url: 'https://api.sgu.se/oppnadata/forutsattningar-skred-finkornig-jordart/ogc/features/v1/collections/aktsam-efterarbetad', table: 'env.sgu_aktsamhet_efterarbetad' },
  { id: 'aktiv_erosion', url: 'https://api.sgu.se/oppnadata/stranderosion-kust/ogc/features/v1/collections/aktiv-erosion', table: 'env.sgu_erosion_aktiv' },
  { id: 'fastmark', url: 'https://api.sgu.se/oppnadata/fastmark/ogc/features/v1/collections/fastmark', table: 'env.sgu_fastmark_stabilitet' },
];

async function runImport() {
  console.log(`\n🚀 STARTING MASSIVE OGC API IMPORT VIA GDAL/OGR2OGR`);
  console.log(`====================================================`);

  const url = new URL(DATABASE_URL);
  const dbname = url.pathname.slice(1);
  const host = url.hostname;
  const user = url.username;
  const password = url.password;
  const port = url.port || '5432';
  const pgConn = `PG:dbname='${dbname}' host='${host}' user='${user}' password='${password}' port='${port}'`;

  for (const item of SGU_COLLECTIONS) {
    console.log(`\n📦 Processing: ${item.id} -> ${item.table}`);
    
    try {
      // Pre-optimization
      console.log(`   - Optimizing table...`);
      await prisma.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS env;`);
      // We don't drop the table, we use -overwrite or -append
      
      const ogrCmd = `"${OGR2OGR_PATH}" -f PostgreSQL "${pgConn}" "OAPIF:${item.url}" ` +
                     `-nln ${item.table} -overwrite -gt 65536 -nlt PROMOTE_TO_MULTI ` +
                     `-lco GEOMETRY_NAME=geom -lco SPATIAL_INDEX=NONE ` +
                     `--config OAPIF_PAGE_SIZE 5000`;

      console.log(`   - Running ogr2ogr stream (this may take a long time)...`);
      execSync(ogrCmd, { stdio: 'inherit' });

      console.log(`   - Rebuilding spatial index...`);
      const idxName = `${item.table.replace('.', '_')}_geom_idx`;
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS ${idxName} ON ${item.table} USING GIST (geom);`);
      await prisma.$executeRawUnsafe(`VACUUM ANALYZE ${item.table};`);
      
      console.log(`   ✅ Completed ${item.id}`);
    } catch (err) {
      console.error(`   ❌ Failed ${item.id}:`, err);
    }
  }

  console.log(`\nALL IMPORTS FINISHED.`);
  await prisma.$disconnect();
}

runImport();
