import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    const result = await prisma.$queryRawUnsafe<any[]>('SELECT "fieldName", "queueType", COUNT(*) as cnt FROM "MetadataReviewQueue" GROUP BY "fieldName", "queueType"');
    const total = result.reduce((acc, curr) => acc + Number(curr.cnt), 0);
    console.log(JSON.stringify({ total, details: result.map(r => ({ ...r, cnt: Number(r.cnt) })) }, null, 2));
}

main().finally(() => prisma.$disconnect());
