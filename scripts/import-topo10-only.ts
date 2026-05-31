import { spawnSync } from 'child_process';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();
const DATABASE_URL = process.env.DATABASE_URL || '';
const OGR2OGR_PATH = 'C:\\Program Files\\GDAL\\ogr2ogr.exe';

const IMPORTS = [
  {
    id: 'topo10_vatten',
    file: 'E:\\GIS-Utbildning\\Kartor\\hydrografi_sverige.gpkg',
    layer: 'hydrolinje',
    table: 'topo10.vatten',
    geomType: 'MULTILINESTRING',
  },
  {
    id: 'topo10_vag',
    file: 'E:\\GIS-Utbildning\\Kartor\\kommunikation_sverige.gpkg',
    layer: 'vaglinje',
    table: 'topo10.vag',
    geomType: 'MULTILINESTRING',
  },
  {
    id: 'topo10_byggnad',
    file: 'E:\\GIS-Utbildning\\Kartor\\byggnadsverk_sverige.gpkg',
    layer: 'byggnad',
    table: 'topo10.byggnad',
    geomType: 'MULTIPOLYGON',
  },
];

async function runImport() {
  console.log(`\n🚀 STARTING TOPO10 BULK IMPORT`);
  console.log(`====================================================\n`);

  const url = new URL(DATABASE_URL);
  const dbname = url.pathname.slice(1);
  const host = url.hostname;
  const user = url.username;
  const password = url.password;
  const port = url.port || '5432';
  const pgConn = `PG:dbname='${dbname}' host='${host}' user='${user}' password='${password}' port='${port}'`;

  console.log('⚙️  Applying PostgreSQL bulk-import settings...');
  try {
    await prisma.$executeRawUnsafe(`SET synchronous_commit = off`);
    await prisma.$executeRawUnsafe(`SET maintenance_work_mem = '4GB'`);
    await prisma.$executeRawUnsafe(`SET work_mem = '256MB'`);
    await prisma.$executeRawUnsafe(`SET max_parallel_maintenance_workers = 4`);
    console.log('   ✅ Session tuned\n');
  } catch (e) {
    console.error('   ⚠️  Could not apply settings:', (e as Error).message);
  }

  for (const item of IMPORTS) {
    console.log(`📦 Importing: ${item.id}`);
    console.log(`   Source: ${item.file}`);
    console.log(`   Layer: ${item.layer} → ${item.table}`);

    try {
      const schema = item.table.split('.')[0];
      await prisma.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS ${schema};`);

      const args = [
        '-f',
        'PostgreSQL',
        pgConn,
        item.file,
        item.layer,
        '-nln',
        item.table,
        '-overwrite',
        '-gt',
        '65536',
        '-nlt',
        'PROMOTE_TO_MULTI',
        '-lco',
        'GEOMETRY_NAME=geom',
        '-lco',
        'SPATIAL_INDEX=NONE',
        '-t_srs',
        'EPSG:4326',
        '-nlt',
        item.geomType || 'MULTIPOLYGON',
        '-progress',
      ];

      console.log(`   Running ogr2ogr...`);
      const result = spawnSync(OGR2OGR_PATH, args, { encoding: 'utf8', stdio: 'inherit' });

      if (result.status === 0) {
        const countRes = await prisma.$queryRawUnsafe(`SELECT count(*) as c FROM ${item.table}`);
        const count = (countRes as any)[0].c;
        console.log(`   ✅ Imported ${count.toLocaleString()} rows\n`);
      } else {
        console.error(`   ❌ Import failed with status ${result.status}\n`);
      }
    } catch (e) {
      console.error(`   ❌ Error:`, (e as Error).message, '\n');
    }
  }

  console.log('📊 Final Status:');
  for (const item of IMPORTS) {
    try {
      const res = await prisma.$queryRawUnsafe(`SELECT count(*) as c FROM ${item.table}`);
      const count = (res as any)[0].c;
      console.log(`   ${item.table.padEnd(20)}: ${count.toLocaleString().padStart(10)} rows`);
    } catch {
      console.log(`   ${item.table.padEnd(20)}: ERROR`);
    }
  }

  await prisma.$disconnect();
  console.log('\n✅ Done!');
}

runImport().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
