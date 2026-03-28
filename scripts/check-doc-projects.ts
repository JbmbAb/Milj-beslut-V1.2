import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    const docs = await prisma.documentRecord.findMany({
        select: { id: true, projectId: true },
        take: 5
    });
    console.log(JSON.stringify(docs, null, 2));
}

main().finally(() => prisma.$disconnect());
