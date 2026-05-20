import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const docs = await prisma.documentRecord.count();
  const reqs = await prisma.requirementRecord.count();
  const sgu = await prisma.$queryRawUnsafe('SELECT count(*) FROM env.sgu_ground_layer');
  const stage = await prisma.$queryRawUnsafe('SELECT count(*) FROM stage.sgu_ground_layer_raw');
  
  console.log('--- PROGRESS REPORT ---');
  console.log(`Documents: ${docs}`);
  console.log(`Requirements: ${reqs}`);
  console.log(`SGU Core: ${JSON.stringify(sgu, (k, v) => typeof v === 'bigint' ? v.toString() : v)}`);
  console.log(`SGU Stage: ${JSON.stringify(stage, (k, v) => typeof v === 'bigint' ? v.toString() : v)}`);
  
  await prisma.$disconnect();
}

main();
