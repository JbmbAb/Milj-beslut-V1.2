import { PrismaClient } from '@prisma/client';
import { execSync } from 'node:child_process';

const prisma = new PrismaClient();

async function main() {
  console.log('=== Master Sync for Miljöbeslut.se ===');
  
  try {
    const org = await prisma.organisation.findFirst();
    const project = await prisma.project.findFirst();
    
    if (!org || !project) {
      console.error('❌ Error: No Organisation or Project found in DB. Run migrations/seeding first.');
      return;
    }
    
    console.log(`Using Org: ${org.id}, Project: ${project.id}`);

    // 1. Ingest Emails/Documents
    console.log('\n--- Step 1: Ingesting Documents ---');
    try {
      const ingestCmd = `npx tsx scripts/import/idempotent-ingest.ts --input="C:\\Users\\jimmy\\Desktop\\OutlookExport\\manifest.csv" --project-id=${project.id} --organisation-id=${org.id}`;
      console.log(`Running: ${ingestCmd}`);
      execSync(ingestCmd, { stdio: 'inherit' });
    } catch (e: any) {
      console.error(`⚠️ Step 1 failed, but continuing...`);
    }

    // 2. Extract Requirements
    console.log('\n--- Step 2: Extracting Requirements ---');
    try {
      const extractCmd = `npx tsx scripts/import/extract-requirements-idempotent.ts --project-id=${project.id}`;
      console.log(`Running: ${extractCmd}`);
      execSync(extractCmd, { stdio: 'inherit' });
    } catch (e: any) {
      console.error(`⚠️ Step 2 failed, but continuing...`);
    }

    // 3. SGU Risk Layers
    console.log('\n--- Step 3: SGU Risk Layers ---');
    try {
      const sguCmd = `npx tsx scripts/import/import-sgu-risk-layers.ts --layer all --allow-national --max-features 1000`;
      console.log(`Running: ${sguCmd}`);
      execSync(sguCmd, { stdio: 'inherit' });
    } catch (e: any) {
      console.error(`⚠️ Step 3 failed: ${e.message}`);
    }

    console.log('\n✅ Master Sync attempt finished.');

  } catch (error) {
    console.error('❌ Master Sync fatal error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
