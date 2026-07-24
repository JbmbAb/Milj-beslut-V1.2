import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  console.log('Testing suffix stripping logic...');
  const testVal = 'ORSA STACKMORA 3:12>1';
  const stripped = await prisma.$queryRaw<any[]>`SELECT REGEXP_REPLACE(${testVal}, '>.*$', '') as s`;
  console.log(`Original: ${testVal}, Stripped: ${stripped[0].s}`);

  console.log('Refining core.property_unit mapping again...');

  await prisma.$executeRawUnsafe('DROP VIEW IF EXISTS core.property_unit CASCADE;');
  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE VIEW core.property_unit AS
    SELECT 
      objektidentitet AS source_key,
      UPPER(TRIM(CONCAT(kommunnamn, ' ', trakt, ' ', etikett))) AS designation,
      core.normalize_designation(REGEXP_REPLACE(UPPER(TRIM(CONCAT(kommunnamn, ' ', trakt, ' ', etikett))), '>.*$', '')) AS designation_norm,
      kommunkod AS municipality_code,
      kommunnamn AS municipality_name,
      lanskod AS county_code,
      'lm_fastighetsytor' AS source_dataset,
      senastandrad AS source_updated_at,
      to_jsonb(r) - 'geom' AS raw_properties,
      geom
    FROM env.registerenhetsomradesytor r;
  `);

  console.log('Mapping refined with suffix stripping.');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
