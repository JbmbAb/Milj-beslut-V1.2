import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    const total = await prisma.outlookAttachment.count({ where: { parsed: false } });
    const withDoc = await prisma.outlookAttachment.count({ where: { parsed: false, documentId: { not: null } } });
    const withoutDoc = total - withDoc;

    console.log(`Unparsed Attachments Total: ${total}`);
    console.log(`With DocumentId: ${withDoc}`);
    console.log(`Without DocumentId: ${withoutDoc}`);
}

main().finally(() => prisma.$disconnect());
