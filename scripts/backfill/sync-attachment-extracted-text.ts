/**
 * Synka attachments.extracted_text från DocumentContent.searchText.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.documentRecord.findMany({
    where: {
      content: { isNot: null },
      OutlookAttachment: {
        some: {
          OR: [{ extractedText: null }, { extractedText: '' }],
        },
      },
    },
    select: {
      id: true,
      content: { select: { searchText: true } },
    },
    take: 5000,
  });

  let synced = 0;
  for (const row of rows) {
    const text = row.content?.searchText?.trim();
    if (!text) continue;
    const result = await prisma.outlookAttachment.updateMany({
      where: {
        documentId: row.id,
        OR: [{ extractedText: null }, { extractedText: '' }],
      },
      data: {
        extractedText: text.slice(0, 500_000),
        parsed: true,
        parseFailureReason: null,
      },
    });
    synced += result.count;
  }

  const attachmentsWithText = await prisma.outlookAttachment.count({
    where: { extractedText: { not: null } },
  });

  console.log(JSON.stringify({ candidates: rows.length, synced, attachmentsWithText }, null, 2));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
