/**
 * Importerar vektorlager från D:\GEodata till PostGIS (ogr2ogr).
 *
 * Run:
 *   npx dotenv -e .env -- tsx scripts/import/import-d-geodata-vectors.ts
 *   npx dotenv -e .env -- tsx scripts/import/import-d-geodata-vectors.ts --only=msb_flood,svaro
 */
import { spawnSync } from 'child_process';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

const prisma = new PrismaClient();
const DATABASE_URL = process.env.DATABASE_URL || '';
const OGR2OGR_PATH = process.env.OGR2OGR_PATH ?? 'C:\\Program Files\\GDAL\\ogr2ogr.exe';
const GEODATA_DIR = process.env.GEODATA_DIR ?? 'D:\\GEodata';

type VectorImportJob = {
  id: string;
  file: string;
  layer: string;
  table: string;
  sql?: string;
};

const IMPORTS: VectorImportJob[] = [
  {
    id: 'svaro_avrinningsomraden',
    file: path.join(GEODATA_DIR, 'SVARO_2016.zip'),
    layer: 'SVARO_2016',
    table: 'env.smhi_svar_2016_avrinningsomraden',
  },
  {
    id: 'svar_vattenomraden',
    file: path.join(GEODATA_DIR, 'VARO_2016.zip'),
    layer: 'vm.VISS_SW_VARO_2016_1_RISK_TOTALT',
    table: 'env.svar_vattenomraden_2016',
  },
  {
    id: 'msb_flood',
    file: path.join(GEODATA_DIR, 'InspireMSB_APSFR.zip'),
    layer: 'InspireMSB_APSFR',
    table: 'env.msb_flood_risk_apsfr',
  },
  {
    id: 'sgu_geo_interest_point',
    file: path.join(GEODATA_DIR, 'geologiskt-intressanta-platser.gpkg'),
    layer: 'geoplats_punkt',
    table: 'env.sgu_geological_interest_point',
  },
  {
    id: 'sgu_geo_interest_poly',
    file: path.join(GEODATA_DIR, 'geologiskt-intressanta-platser.gpkg'),
    layer: 'geoplats_yta',
    table: 'env.sgu_geological_interest_poly',
  },
];

function parseOnlyKeys(argv: string[]): Set<string> | null {
  const onlyArg = argv.find((a) => a.startsWith('--only='));
  if (!onlyArg) return null;
  return new Set(
    onlyArg
      .slice('--only='.length)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

async function runImport() {
  const only = parseOnlyKeys(process.argv);
  const jobs = only ? IMPORTS.filter((j) => only.has(j.id)) : IMPORTS;

  console.log(`\nImport vektorlager från ${GEODATA_DIR}`);
  console.log(`Jobb: ${jobs.length}`);

  const url = new URL(DATABASE_URL);
  const pgConn = `PG:dbname='${url.pathname.slice(1)}' host='${url.hostname}' user='${url.username}' password='${url.password}' port='${url.port || '5432'}'`;

  for (const item of jobs) {
    console.log(`\n→ ${item.id} → ${item.table}`);

    if (!fs.existsSync(item.file)) {
      console.warn(`   SKIP: saknas ${item.file}`);
      continue;
    }

    const source = item.file.endsWith('.zip')
      ? `/vsizip/${item.file.replace(/\\/g, '/')}`
      : item.file;

    try {
      const schema = item.table.split('.')[0];
      await prisma.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS ${schema};`);

      const args = ['-f', 'PostgreSQL', pgConn, source];
      if (item.sql) {
        args.push('-sql', item.sql);
      } else {
        args.push(item.layer);
      }
      args.push(
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
        'EPSG:3006',
      );

      const result = spawnSync(OGR2OGR_PATH, args, { stdio: 'inherit' });
      if (result.status !== 0) {
        throw new Error(`ogr2ogr status ${result.status}`);
      }

      const idxName = `${item.table.replace('.', '_')}_geom_idx`;
      await prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS ${idxName} ON ${item.table} USING GIST (geom);`,
      );
      await prisma.$executeRawUnsafe(`VACUUM ANALYZE ${item.table};`);
      console.log(`   OK: ${item.id}`);
    } catch (err) {
      console.error(`   FAIL: ${item.id}`, err);
    }
  }

  await prisma.$disconnect();
}

runImport().catch((err) => {
  console.error(err);
  process.exit(1);
});
