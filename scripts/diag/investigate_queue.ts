import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  try {
    const docs = await prisma.documentRecord.findMany({
      where: { status: 'METADATA_ONLY' },
      take: 5,
      select: { id: true, fileSha256: true }
    });
    console.log('Docs:', docs);
    
    for (const doc of docs) {
      const attachment = await prisma.$queryRawUnsafe("SELECT * FROM attachments WHERE document_id = $1 OR attachment_hash = $2;", doc.id, doc.fileSha256);
      console.log(`Doc ${doc.id} Attachment:`, attachment);
    }
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}
main();
