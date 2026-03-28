import { PrismaClient } from '@prisma/client';
import { extractDocumentTextAndChunk } from '../../server/services/searchService';

async function main() {
  const prisma = new PrismaClient();
  const doc = await prisma.documentRecord.findFirst({
    where: { status: 'METADATA_ONLY' }
  });
  if (!doc) return;
  console.log(`Testing OCR for [${doc.id}] ${doc.originalName}...`);
  try {
     const res = await extractDocumentTextAndChunk(doc.id, true); // true = FORCE OCR
     console.log('Success:', res);
  } catch (e) {
     console.error('Failed:', e);
  } finally {
     await prisma.$disconnect();
  }
}
main();
