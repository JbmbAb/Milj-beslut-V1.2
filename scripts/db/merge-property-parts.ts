import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  console.log('Merging property parts in core.property_unit view...');

  await prisma.$executeRawUnsafe('DROP VIEW IF EXISTS core.property_unit CASCADE;');
  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE VIEW core.property_unit AS
    WITH raw_data AS (
      SELECT 
        objektidentitet,
        kommunnamn,
        trakt,
        etikett,
        senastandrad,
        geom,
        core.normalize_designation(REGEXP_REPLACE(UPPER(TRIM(CONCAT(kommunnamn, ' ', trakt, ' ', etikett))), '>.*$', '')) AS d_norm,
        REGEXP_REPLACE(UPPER(TRIM(CONCAT(kommunnamn, ' ', trakt, ' ', etikett))), '>.*$', '') AS d_full,
        kommunkod,
        lanskod
      FROM env.registerenhetsomradesytor
    )
    SELECT 
      MIN(objektidentitet) AS source_key, -- Use one of the IDs as primary
      d_full AS designation,
      d_norm AS designation_norm,
      MIN(kommunkod) AS municipality_code,
      MIN(kommunnamn) AS municipality_name,
      MIN(lanskod) AS county_code,
      'lm_fastighetsytor_merged' AS source_dataset,
      MAX(senastandrad) AS source_updated_at,
      jsonb_agg(to_jsonb(r) - 'geom') AS raw_properties_list,
      ST_Multi(ST_Union(geom)) AS geom
    FROM raw_data r
    GROUP BY d_norm, d_full;
  `);

  console.log('View updated with ST_Union aggregation.');

  const check = await prisma.$queryRaw<any[]>`
    SELECT designation, ST_NumGeometries(geom) as parts
    FROM core.property_unit 
    WHERE designation = 'ORSA STACKMORA 3:12';
  `;
  console.log('Result for ORSA STACKMORA 3:12:', check);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
