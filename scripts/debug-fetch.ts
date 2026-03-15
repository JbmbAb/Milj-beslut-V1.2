import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const projectId = 'cmmpmyhc90004cuyg57iuzcmo';
  const rows = await prisma.$queryRawUnsafe(`
    SELECT 
      a.attachment_hash, 
      a.document_id, 
      a.stored_path,
      d."projectId"
    FROM attachments a
    INNER JOIN "DocumentRecord" d ON d.id = a.document_id
    WHERE a.parsed = FALSE
      AND d."projectId" = $1
    LIMIT 5
  `, projectId);
  
  console.log('Sample Rows:', JSON.stringify(rows, null, 2));
  await prisma.$disconnect();
}

main();
