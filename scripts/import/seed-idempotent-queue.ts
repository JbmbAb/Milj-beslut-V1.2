import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('--- SEEDING ATTACHMENTS FOR REQUIREMENT EXTRACTION ---');
  
  const docs = await prisma.documentRecord.findMany({
    select: { id: true, originalName: true, fileSize: true }
  });

  console.log(`Checking ${docs.length} documents...`);

  // Ensure tables exist by running the extractor dry run once or manually
  // Actually the extractor's ensureTables() runs on every start.
  
  let seeded = 0;
  let skipped = 0;

  for (const doc of docs) {
    const attachmentHash = `HASH-${doc.id}`; // Simple mapping for this migration
    const messageId = `MSG-${doc.id}`;
    
    // Check if exists in RAW SQL table
    const existing = await prisma.$queryRawUnsafe<any[]>(
      'SELECT attachment_hash FROM attachments WHERE attachment_hash = $1',
      attachmentHash
    );

    if (existing.length > 0) {
      skipped++;
      continue;
    }

    // Seed email_messages
    await prisma.$executeRawUnsafe(
      `INSERT INTO email_messages (message_id, subject, status) 
       VALUES ($1, $2, 'PROCESSED') ON CONFLICT DO NOTHING`,
      messageId,
      `Sync: ${doc.originalName}`
    );

    // Seed attachments
    await prisma.$executeRawUnsafe(
      `INSERT INTO attachments (attachment_hash, canonical_message_id, filename, filesize, checksum_sha256, parsed, document_id)
       VALUES ($1, $2, $3, $4, 'none', FALSE, $5)`,
      attachmentHash,
      messageId,
      doc.originalName,
      doc.fileSize,
      doc.id
    );

    seeded++;
    if (seeded % 100 === 0) console.log(`  Seeded ${seeded}...`);
  }

  console.log(`Seeded: ${seeded}`);
  console.log(`Already existed: ${skipped}`);
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
