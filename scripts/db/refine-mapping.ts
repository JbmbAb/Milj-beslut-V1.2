// U30F F1 (PRES-05): RETIRED. This script destroys or redefines protected LU relations outside the governed
// path; it is refused before it connects to anything. The reason and the replacement are recorded in
// RETIRED_DESTRUCTIVE_SCRIPTS (packages/spatial-provider-postgis/src/ProtectedRelationGate.ts). No override.
import { refuseRetiredDestructiveScript } from '../../packages/spatial-provider-postgis/src/ProtectedRelationGate';
refuseRetiredDestructiveScript('scripts/db/refine-mapping.ts');
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

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
