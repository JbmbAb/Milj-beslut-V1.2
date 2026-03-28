import { prisma } from '../server/db/prisma';

async function main() {
    console.log('Resetting parsed flag for attachments where document has no requirements...');
    const count = await prisma.$executeRawUnsafe(`
    UPDATE attachments 
    SET parsed = FALSE 
    WHERE document_id IN (
      SELECT id 
      FROM "DocumentRecord" 
      WHERE NOT EXISTS (
        SELECT 1 
        FROM "RequirementRecord" r 
        WHERE r."documentId" = "DocumentRecord".id
      )
    )
  `);
    console.log(`Reset parsed flag for ${count} attachments.`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
