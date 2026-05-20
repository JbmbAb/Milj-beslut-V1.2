import { spawnSync } from 'child_process';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();
const DATABASE_URL = process.env.DATABASE_URL || '';
const OGR2OGR_PATH = 'C:\\Program Files\\GDAL\\ogr2ogr.exe';

const JORDARTER = {
  file: 'E:\\MiljoBeslut_Produktdata_Sources\\Geodata\\jordarter25k-100k\\jordarter25k_100k.gpkg',
  layer: 'oversta_ytlager',
  table: 'env.sgu_soil_type_25k_100k',
};

async function verify() {
  console.log(`\n📊 VERIFYING JORDARTER IMPORT`);
  console.log(`====================================================\n`);

  // Check current DB count
  try {
    const res = await prisma.$queryRawUnsafe(
      `SELECT count(*) as count FROM ${JORDARTER.table}`
    );
    const dbCount = (res as any)[0].count;
    console.log(`📦 Database row count: ${dbCount.toLocaleString()}`);

    // Try to re-import and count
    console.log(`\n🔄 Re-importing to verify source has ${dbCount} rows...`);

    const url = new URL(DATABASE_URL);
    const dbname = url.pathname.slice(1);
    const host = url.hostname;
    const user = url.username;
    const password = url.password;
    const port = url.port || '5432';
    const pgConn = `PG:dbname='${dbname}' host='${host}' user='${user}' password='${password}' port='${port}'`;

    const args = [
      '-f', 'PostgreSQL',
      pgConn,
      JORDARTER.file,
      JORDARTER.layer,
      '-nln', JORDARTER.table,
      '-overwrite',
      '-gt', '65536',
      '-lco', 'GEOMETRY_NAME=geom',
      '-t_srs', 'EPSG:4326',
      '-progress'
    ];

    const result = spawnSync(OGR2OGR_PATH, args, { encoding: 'utf8', stdio: 'inherit' });

    if (result.status === 0) {
      const newRes = await prisma.$queryRawUnsafe(
        `SELECT count(*) as count FROM ${JORDARTER.table}`
      );
      const newCount = (newRes as any)[0].count;
      console.log(`\n✅ Fresh import complete: ${newCount.toLocaleString()} rows`);

      if (newCount === dbCount) {
        console.log(`   ✨ Count unchanged → data is COMPLETE`);
      } else {
        console.log(`   📝 Count changed: ${dbCount} → ${newCount}`);
      }
    } else {
      console.error(`❌ Re-import failed with status ${result.status}`);
    }
  } catch (e) {
    console.error('Error:', (e as Error).message);
  } finally {
    await prisma.$disconnect();
  }
}

verify();
