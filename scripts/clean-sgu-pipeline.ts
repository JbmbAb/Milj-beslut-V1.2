import { PrismaClient } from '@prisma/client';
import { promises as fs } from 'node:fs';

const prisma = new PrismaClient();

async function main() {
  console.log('--- Cleaning and Re-running SGU Pipeline ---');
  try {
    const dropSQL = `
      DROP TABLE IF EXISTS stage.sgu_ground_layer_raw CASCADE;
      DROP TABLE IF EXISTS env.sgu_ground_layer CASCADE;
      DROP TABLE IF EXISTS stage.sgu_landslide_feature_raw CASCADE;
      DROP TABLE IF EXISTS env.sgu_landslide_feature CASCADE;
    `;
    
    console.log('Dropping existing incomplete tables...');
    await prisma.$executeRawUnsafe(dropSQL);

    const pipelinePath = 'c:/Users/jimmy/Desktop/Examens arbete/Kod/Ny mapp/remix_-copy-of-miljöbeslut.se-portal/scripts/db/create_sgu_layers_pipeline.sql';
    const pipelineSQL = await fs.readFile(pipelinePath, 'utf8');
    
    const statements = pipelineSQL
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));

    for (const statement of statements) {
      console.log(`Executing: ${statement.slice(0, 50)}...`);
      await prisma.$executeRawUnsafe(statement);
    }
    
    console.log('✅ Pipeline re-run successfully.');

  } catch (error: any) {
    console.error('❌ Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

main();
