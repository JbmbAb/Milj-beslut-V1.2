/**
 * Importerar Natura 2000 Protected Sites GML (SPA/SCI) till env.natura2000_area.
 *
 * Run:
 *   npx dotenv -e .env -- tsx scripts/import/import-n2k-gml.ts
 *   npx dotenv -e .env -- tsx scripts/import/import-n2k-gml.ts --spa=path --sci=path
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();
const OGR2OGR = process.env.OGR2OGR_PATH ?? 'C:\\Program Files\\GDAL\\ogr2ogr.exe';

function readArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

function buildPgConn(databaseUrl: string): string {
  const u = new URL(databaseUrl);
  const db = u.pathname.replace(/^\//, '');
  return `PG:dbname=${db} host=${u.hostname} port=${u.port || '5432'} user=${u.username} password=${u.password}`;
}

async function importGml(
  pgConn: string,
  gmlPath: string,
  category: 'SPA' | 'SCI',
  stagingTable: string,
): Promise<void> {
  if (!fs.existsSync(gmlPath)) {
    throw new Error(`Saknas: ${gmlPath}`);
  }

  console.log(`\n[${category}] ${gmlPath} → staging ${stagingTable}`);

  const args = [
    '-f',
    'PostgreSQL',
    pgConn,
    gmlPath,
    '-nln',
    stagingTable,
    '-nlt',
    'PROMOTE_TO_MULTI',
    '-t_srs',
    'EPSG:3006',
    '-lco',
    'GEOMETRY_NAME=wkb_geometry',
    '--config',
    'PG_USE_COPY',
    'YES',
    '-skipfailures',
    '-overwrite',
  ];

  const result = spawnSync(OGR2OGR, args, { stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`ogr2ogr misslyckades för ${category} (exit ${result.status})`);
  }

  const merged = await prisma.$executeRawUnsafe(`
    INSERT INTO env.natura2000_area (external_id, site_name, category, wkb_geometry)
    SELECT
      COALESCE(NULLIF(localid, ''), gml_id) AS external_id,
      NULLIF(text, '') AS site_name,
      '${category}' AS category,
      wkb_geometry
    FROM ${stagingTable}
    WHERE wkb_geometry IS NOT NULL
    ON CONFLICT (external_id) DO UPDATE SET
      site_name = EXCLUDED.site_name,
      category = EXCLUDED.category,
      wkb_geometry = EXCLUDED.wkb_geometry;
  `);

  console.log(`[${category}] upsert rader (executeRaw): ${merged}`);
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL saknas');
  }

  const spa =
    readArg('spa') ??
    path.join(process.env.USERPROFILE ?? '', 'Downloads', 'PS.protectedSites.SPA.gml');
  const sci =
    readArg('sci') ??
    path.join(process.env.USERPROFILE ?? '', 'Downloads', 'PS.protectedSites.SCI.gml');

  const pgConn = buildPgConn(databaseUrl);

  await prisma.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS stage`);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS env.natura2000_area (
      external_id text PRIMARY KEY,
      site_name text,
      category text,
      wkb_geometry geometry(MultiPolygon, 3006)
    );
  `);

  if (fs.existsSync(spa)) {
    await importGml(pgConn, spa, 'SPA', 'stage.n2k_spa_raw');
  } else {
    console.warn(`Hoppar över SPA (saknas): ${spa}`);
  }

  if (fs.existsSync(sci)) {
    await importGml(pgConn, sci, 'SCI', 'stage.n2k_sci_raw');
  } else {
    console.warn(`Hoppar över SCI (saknas): ${sci}`);
  }

  const count = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*)::bigint AS count FROM env.natura2000_area
  `;
  console.log(`\nKlart. env.natura2000_area: ${count[0]?.count ?? 0} rader`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
