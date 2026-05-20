import { spawnSync } from 'child_process';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();
const DATABASE_URL = process.env.DATABASE_URL || '';
const OGR2OGR_PATH = 'C:\\Program Files\\GDAL\\ogr2ogr.exe';

const IMPORTS = [
  {
    id: 'sgu_soil_types_25k_100k',
    file: 'E:\\MiljoBeslut_Produktdata_Sources\\Geodata\\jordarter25k-100k\\jordarter25k_100k.gpkg',
    layer: 'oversta_ytlager',
    table: 'env.sgu_soil_type_25k_100k',
  },
  {
    id: 'smhi_svar_2022',
    file: 'E:\\MiljoBeslut_Produktdata_Sources\\Geodata\\SMHI_SVAR_2022\\re-extracted\\SVAR2022_delavrinningsomraden.gpkg',
    layer: 'SVAR2022_DelavrinningsomrÅden_2022',
    table: 'env.smhi_svar_2022_delavrinningsomraden',
  },
  {
    id: 'topo10_mark',
    file: 'E:\\GIS-Utbildning\\Kartor\\mark_sverige.gpkg',
    layer: 'mark',
    table: 'topo10.mark',
  },
  {
    id: 'topo10_vatten',
    file: 'E:\\GIS-Utbildning\\Kartor\\hydrografi_sverige.gpkg',
    layer: 'hydrolinje',
    table: 'topo10.vatten',
  },
  {
    id: 'topo10_vag',
    file: 'E:\\GIS-Utbildning\\Kartor\\kommunikation_sverige.gpkg',
    layer: 'vaglinje',
    table: 'topo10.vag',
  },
  {
    id: 'nv_naturreservat',
    file: 'E:\\MiljoBeslut_Produktdata_Sources\\Geodata\\Naturvardsverket\\re-extracted\\NR\\NR\\NR_polygon.shp',
    layer: 'NR_polygon',
    table: 'env.nv_naturreservat',
  },
  {
    id: 'nv_natura2000_sci',
    file: 'E:\\MiljoBeslut_Produktdata_Sources\\Geodata\\Naturvardsverket\\re-extracted\\SCI\\SCI_Rikstackande\\SCI_ej_alvar_rikstackande\\SCI_ej_alvar_rikstackande.shp',
    layer: 'SCI_ej_alvar_rikstackande',
    table: 'env.nv_natura2000_sci',
  },
  {
    id: 'nv_natura2000_spa',
    file: 'E:\\MiljoBeslut_Produktdata_Sources\\Geodata\\Naturvardsverket\\re-extracted\\SPA\\SPA_Rikstackande\\SPA_rikstackande.shp',
    layer: 'SPA_rikstackande',
    table: 'env.nv_natura2000_spa',
  }
];

async function runBulkImport() {
  console.log(`\n🚀 STARTING BULK GEODATA IMPORT FROM E: DRIVE`);
  console.log(`====================================================`);

  const url = new URL(DATABASE_URL);
  const dbname = url.pathname.slice(1);
  const host = url.hostname;
  const user = url.username;
  const password = url.password;
  const port = url.port || '5432';
  const pgConn = `PG:dbname='${dbname}' host='${host}' user='${user}' password='${password}' port='${port}'`;

  for (const item of IMPORTS) {
    console.log(`\n📦 Processing: ${item.id} -> ${item.table}`);
    console.log(`   Source: ${item.file}`);

    try {
      const schema = item.table.split('.')[0];
      await prisma.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS ${schema};`);

      const args = [
        '-f', 'PostgreSQL',
        pgConn,
        item.file,
        item.layer,
        '-nln', item.table,
        '-overwrite',
        '-gt', '65536',
        '-nlt', 'PROMOTE_TO_MULTI',
        '-lco', 'GEOMETRY_NAME=geom',
        '-lco', 'SPATIAL_INDEX=NONE',
        '-t_srs', 'EPSG:4326',
        '-nlt', 'MULTIPOLYGON'
      ];

      // Special handling for shapefiles (often Latin1)
      if (item.file.endsWith('.shp')) {
        args.push('-oo', 'ENCODING=LATIN1');
      }

      console.log(`   - Running ogr2ogr import...`);
      const result = spawnSync(OGR2OGR_PATH, args, { stdio: 'inherit' });
      
      if (result.status !== 0) {
        throw new Error(`ogr2ogr failed with status ${result.status}`);
      }

      console.log(`   - Building spatial index...`);
      const idxName = `${item.table.replace('.', '_')}_geom_idx`;
      await prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS ${idxName} ON ${item.table} USING GIST (geom);`,
      );
      await prisma.$executeRawUnsafe(`VACUUM ANALYZE ${item.table};`);

      console.log(`   ✅ Completed ${item.id}`);
    } catch (err) {
      console.error(`   ❌ Failed ${item.id}:`, err);
    }
  }

  console.log(`\nBULK IMPORT FINISHED.`);
  await prisma.$disconnect();
}

runBulkImport();
