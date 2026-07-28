import dotenv from 'dotenv';
dotenv.config();
import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();

async function main() {
  const tablesToDrop = [
    // SGU — redan promote till env
    'sgu_soil_type_25k_100k_c735cd29',
    'sgu_soil_type_25k_100k_2bd32199',
    'sgu_fastmark_stabilitet_8636a6c2',
    'sgu_jorddjupsmodell_10m_008be7a3',
    'sgu_well_49202690',
    'sgu_landslide_feature_744cf007',
    'sgu_landform_750k_bc352cf5',
    'sgu_erosion_aktiv_06dc4ff8',
    // LM / hydro / climate — orphan staging efter promote
    'belagenhetsadress_6b9262fd',
    'ortnamn_2ee88b65',
    'water_catchment_e7cdd777',
    'flood_risk_area_a53174f3',
    'kommuner_1f9b2a1d',
    'kommuner_51160251',
    'lan_4cc9902a',
    'lan_51160251',
    'rike_51160251',
    'rike_ba723cb7',
    'ebh_potentiellt_fororenade_omraden_02fccffc',
  ];

  console.log('=== Cleanup Plan: Dropping Staging Tables in lm_staging ===');
  console.log('We will drop the following tables from "lm_staging" schema:');
  for (const t of tablesToDrop) {
    console.log(`  - lm_staging.${t}`);
  }

  const execute = process.argv.includes('--execute');
  if (!execute) {
    console.log('\n[DRY RUN] Run with --execute to perform the deletion.');
    return;
  }

  console.log('\nExecuting drops...');
  for (const t of tablesToDrop) {
    try {
      await p.$executeRawUnsafe(`DROP TABLE IF EXISTS "lm_staging"."${t}" CASCADE`);
      console.log(`  - Successfully dropped lm_staging.${t}`);
    } catch (err: any) {
      console.log(`  - Error dropping lm_staging.${t}: ${err.message}`);
    }
  }
  console.log('\nCleanup completed.');
}

main()
  .catch(console.error)
  .finally(() => p.$disconnect());
