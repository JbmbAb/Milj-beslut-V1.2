import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    const result = await prisma.$queryRawUnsafe<any[]>(
        'SELECT "projectId", COUNT(*) as cnt FROM "DocumentRecord" GROUP BY "projectId" ORDER BY cnt DESC LIMIT 5'
    );
    console.log(JSON.stringify(result.map(r => ({ ...r, cnt: Number(r.cnt) })), null, 2));
}

main().finally(() => prisma.$disconnect());
