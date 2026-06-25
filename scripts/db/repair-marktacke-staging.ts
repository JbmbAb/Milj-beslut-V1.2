import fs from 'fs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const manifestPath =
  'H:/Delade enheter/Miljöbeslut/GEO_Master_Archive/Data/Lantmateriet/Marktacke_Nationell/Mark/2026-06-25/manifest.json';
const stagingTable = 'lm_staging.marktacke_07497f79';
const stagingSchema = 'lm_staging';
const stagingTableName = 'marktacke_07497f79';
const targetSchema = 'env';
const targetTable = 'marktacke';
const contentBundleSha256 = '07497f797d53700a8426fc612df01c96bd1b7bba7220aaec7ff81356fa5510df';

type QaRow = {
  total_rows: bigint;
  null_geom_rows: bigint;
  invalid_geom_rows: bigint;
  srid: number | null;
  empty_geom_rows: bigint;
  z_geom_rows: bigint;
};

async function readQa(): Promise<QaRow> {
  const rows = await prisma.$queryRawUnsafe<QaRow[]>(
    `SELECT
       COUNT(*)::bigint AS total_rows,
       COUNT(*) FILTER (WHERE geom IS NULL)::bigint AS null_geom_rows,
       COUNT(*) FILTER (WHERE geom IS NOT NULL AND NOT ST_IsValid(geom))::bigint AS invalid_geom_rows,
       MAX(ST_SRID(geom))::int AS srid,
       COUNT(*) FILTER (WHERE geom IS NOT NULL AND ST_IsEmpty(geom))::bigint AS empty_geom_rows,
       COUNT(*) FILTER (WHERE geom IS NOT NULL AND ST_CoordDim(geom) > 2)::bigint AS z_geom_rows
     FROM ${stagingTable}`,
  );
  return rows[0];
}

function formatQa(row: QaRow): string {
  return JSON.stringify(
    {
      totalRows: Number(row.total_rows),
      nullGeomRows: Number(row.null_geom_rows),
      invalidGeomRows: Number(row.invalid_geom_rows),
      emptyGeomRows: Number(row.empty_geom_rows),
      zGeomRows: Number(row.z_geom_rows),
      srid: row.srid,
    },
    null,
    2,
  );
}

async function main() {
  const before = await readQa();
  console.log(`Before repair: ${formatQa(before)}`);

  if (Number(before.invalid_geom_rows) > 0) {
    await prisma.$executeRawUnsafe(
      `UPDATE ${stagingTable}
       SET geom = ST_SetSRID(ST_Multi(ST_CollectionExtract(ST_MakeValid(geom), 3)), 3006)
       WHERE geom IS NOT NULL AND NOT ST_IsValid(geom)`,
    );
  }

  const afterValidityRepair = await readQa();
  if (Number(afterValidityRepair.z_geom_rows) > 0) {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE ${stagingTable}
       ALTER COLUMN geom TYPE geometry(MultiPolygon, 3006)
       USING ST_Force2D(geom)`,
    );
  }

  const after = await readQa();
  console.log(`After repair: ${formatQa(after)}`);

  if (after.srid !== 3006 || Number(after.total_rows) === 0 || Number(after.invalid_geom_rows) > 0) {
    throw new Error('Marktacke staging QA still fails after ST_MakeValid repair');
  }

  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS idx_${stagingTableName}_geom ON ${stagingSchema}.${stagingTableName} USING GIST (geom)`,
  );
  await prisma.$executeRawUnsafe(`VACUUM ANALYZE ${stagingTable}`);

  const batch = await prisma.postgisImportBatch.findFirst({
    where: {
      content_bundle_sha256: contentBundleSha256,
      target_schema: targetSchema,
      target_table: targetTable,
    },
    orderBy: { started_at: 'desc' },
  });

  if (!batch) {
    throw new Error('No postgis_import_batch row found for marktacke staging');
  }

  await prisma.postgisImportBatch.update({
    where: { id: batch.id },
    data: {
      status: 'STAGING_IMPORTED',
      row_count: Number(after.total_rows),
      dataset_version: '2026-06-25',
      error_message: null,
    },
  });

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.qa_status = 'staging_ok';
  manifest.qa_at = new Date().toISOString();
  manifest.qa_note = `Repaired ${Number(before.invalid_geom_rows)} invalid geometries in staging with ST_MakeValid and forced ${Number(afterValidityRepair.z_geom_rows)} Z geometries to 2D before promote.`;
  delete manifest.qa_error;
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  console.log(`Batch ${batch.id} marked STAGING_IMPORTED; manifest set to staging_ok.`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
