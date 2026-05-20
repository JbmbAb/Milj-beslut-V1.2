import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const prefix = 'cmmqpkopr';
  const docs = await prisma.documentRecord.findMany({
    where: { id: { startsWith: prefix } },
    include: { content: true }
  });
  
  console.log('--- DOC AUDIT ---');
  console.log(`Found ${docs.length} docs matching prefix ${prefix}`);
  if (docs.length > 0) {
    console.log(JSON.stringify(docs[0], (k, v) => typeof v === 'bigint' ? v.toString() : v, 2));
  }

  await prisma.$disconnect();
}

main();
