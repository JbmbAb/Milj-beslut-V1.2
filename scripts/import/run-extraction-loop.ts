import { execSync } from 'child_process';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('--- STARTING EXTRACTION LOOP ---');
  
  while (true) {
    const pendingResult = await prisma.$queryRawUnsafe<any[]>(
      'SELECT COUNT(*) FROM attachments WHERE parsed = FALSE AND document_id IS NOT NULL'
    );
    const count = Number(pendingResult[0].count);
    
    if (count === 0) {
      console.log('No more pending attachments for requirement extraction.');
      break;
    }

    console.log(`Pending attachments: ${count}. Processing batch of 100...`);
    try {
      execSync('npx tsx scripts/import/extract-requirements-idempotent.ts --limit=100', { stdio: 'inherit' });
    } catch (e) {
      console.error('Batch failed, continuing anyway...', e);
    }

    // Refresh count after batch
    const afterResult = await prisma.$queryRawUnsafe<any[]>(
      'SELECT COUNT(*) FROM attachments WHERE parsed = FALSE AND document_id IS NOT NULL'
    );
    const afterCount = Number(afterResult[0].count);

    if (afterCount === count) {
      console.log('Progress stalled (count did not decrease). Stopping loop.');
      break;
    }
  }

  console.log('Extraction loop finished.');
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
