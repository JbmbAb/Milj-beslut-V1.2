import dotenv from 'dotenv';
dotenv.config();
import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();

async function main() {
  const tablesToDrop = [
    'sgu_soil_type_25k_100k_c735cd29', // Den trunkerade jordartskartan (999k rader)
    'sgu_soil_type_25k_100k_2bd32199', // Den fulla jordartskartan i staging (2.95M rader) - nu i env
    'sgu_fastmark_stabilitet_8636a6c2', // Fastmark i staging (2.95M rader) - nu i env
    'sgu_jorddjupsmodell_10m_008be7a3', // Jorddjup i staging (1.73M rader) - nu i env
    'sgu_well_49202690',                // Brunnar i staging (832k rader) - nu i env
    'sgu_landslide_feature_744cf007',    // Jordskred i staging (50k rader) - nu i env
    'sgu_landform_750k_bc352cf5',        // Landformer i staging (2.8k rader) - nu i env
    'sgu_erosion_aktiv_06dc4ff8'         // Kusterosion i staging (204 rader) - nu i env
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

main().catch(console.error).finally(() => p.$disconnect());
