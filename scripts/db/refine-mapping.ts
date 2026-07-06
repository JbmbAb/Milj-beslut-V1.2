import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  console.log('Refining core.property_unit mapping...');

  await prisma.$executeRawUnsafe('DROP VIEW IF EXISTS core.property_unit CASCADE;');
  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE VIEW core.property_unit AS
    SELECT 
      objektidentitet AS source_key,
      UPPER(TRIM(CONCAT(kommunnamn, ' ', trakt, ' ', etikett))) AS designation,
      core.normalize_designation(UPPER(TRIM(CONCAT(kommunnamn, ' ', trakt, ' ', etikett)))) AS designation_norm,
      kommunkod AS municipality_code,
      kommunnamn AS municipality_name,
      lanskod AS county_code,
      'lm_fastighetsytor' AS source_dataset,
      senastandrad AS source_updated_at,
      to_jsonb(r) - 'geom' AS raw_properties,
      geom
    FROM env.registerenhetsomradesytor r;
  `);

  console.log('Mapping refined with trakt included.');
}

main().catch(console.error).finally(() => prisma.$disconnect());
