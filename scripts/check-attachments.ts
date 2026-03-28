import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const attachments = await prisma.$queryRawUnsafe('SELECT count(*) FROM attachments');
  const unparsed = await prisma.$queryRawUnsafe('SELECT count(*) FROM attachments WHERE parsed = FALSE');
  const linked = await prisma.$queryRawUnsafe('SELECT count(*) FROM attachments WHERE document_id IS NOT NULL');
  
  console.log('--- ATTACHMENT STATUS ---');
  console.log(`Total: ${JSON.stringify(attachments, (k, v) => typeof v === 'bigint' ? v.toString() : v)}`);
  console.log(`Unparsed: ${JSON.stringify(unparsed, (k, v) => typeof v === 'bigint' ? v.toString() : v)}`);
  console.log(`Linked to Docs: ${JSON.stringify(linked, (k, v) => typeof v === 'bigint' ? v.toString() : v)}`);
  
  await prisma.$disconnect();
}

main();
