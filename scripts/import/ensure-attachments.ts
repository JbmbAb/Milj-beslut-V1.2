import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('--- ENSURING ATTACHMENTS FOR ALL DOCUMENTS ---');
  
  const docs = await prisma.documentRecord.findMany({
    select: { id: true, organisationId: true }
  });

  console.log(`Checking ${docs.length} documents...`);

  let created = 0;
  let exists = 0;

  for (const doc of docs) {
    const existing = await prisma.outlookAttachment.findFirst({
      where: { documentId: doc.id }
    });

    if (existing) {
      exists++;
      continue;
    }

    // Ensure a corresponding email message exists for the FK
    await prisma.$executeRawUnsafe(
      `INSERT INTO email_messages (message_id, status) VALUES ($1, 'PROCESSED') ON CONFLICT DO NOTHING`,
      `MSG-${doc.id}`
    );

    // Create OutlookAttachment for doc
    await prisma.outlookAttachment.create({
      data: {
        attachmentHash: `HASH-${doc.id}`,
        canonicalMessageId: `MSG-${doc.id}`,
        filename: 'Auto-attachment',
        checksumSha256: 'none',
        documentId: doc.id,
        parsed: false
      }
    });
    created++;
    if (created % 100 === 0) console.log(`  Created ${created}...`);
  }

  console.log(`Created: ${created}`);
  console.log(`Already existed: ${exists}`);
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
