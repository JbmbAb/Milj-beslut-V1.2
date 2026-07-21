import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const attachmentSources = await prisma.outlookAttachment.findMany({
    select: {
      document: {
        select: {
          municipality: true,
          municipalityNormalized: true
        }
      },
      canonicalMessage: {
        select: {
          sender: true
        }
      }
    }
  });

  const stats = {
    municipalityCount: 0,
    otherCount: 0,
    total: attachmentSources.length,
    senders: {} as Record<string, number>
  };

  attachmentSources.forEach(s => {
    const mun = s.document?.municipality || s.document?.municipalityNormalized;
    if (mun) {
      stats.municipalityCount++;
    } else {
      stats.otherCount++;
    }
    const sender = s.canonicalMessage?.sender || 'unknown';
    const domain = sender.split('@')[1] || sender;
    stats.senders[domain] = (stats.senders[domain] || 0) + 1;
  });

  console.log(JSON.stringify(stats, null, 2));
}
main().catch(console.error).finally(() => prisma.$disconnect());
