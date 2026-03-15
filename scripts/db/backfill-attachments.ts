
import { PrismaClient } from '@prisma/client';
import crypto from 'node:crypto';

const prisma = new PrismaClient();

async function main() {
    // 1. Get all DocumentRecords not in attachments
    const docs = await prisma.documentRecord.findMany({
        where: {
            NOT: {
                id: { in: [] } // Just to get them all for now
            }
        }
    });

    console.log(`Checking ${docs.length} documents...`);

    // We need to create a dummy email message to link to if we don't have one
    const dummyEmailId = 'system:backfill';
    await prisma.emailMessage.upsert({
        where: { messageId: dummyEmailId },
        update: {},
        create: {
            messageId: dummyEmailId,
            subject: 'System Backfill',
            status: 'SYSTEM'
        }
    });

    let created = 0;
    for (const doc of docs) {
        const hash = crypto.createHash('sha256').update(doc.id).digest('hex');

        const existing = await prisma.outlookAttachment.findUnique({
            where: { attachmentHash: hash }
        });

        if (!existing) {
            await prisma.outlookAttachment.create({
                data: {
                    attachmentHash: hash,
                    canonicalMessageId: dummyEmailId,
                    filename: doc.originalName || doc.diskName,
                    checksumSha256: doc.fileSha256 || hash,
                    documentId: doc.id,
                    parsed: false,
                    storedPath: doc.absolutePath
                }
            });
            created++;
        }
    }

    console.log(`Backfilled ${created} attachments for extraction queue.`);
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
