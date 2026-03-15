
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
    const result: any[] = await prisma.$queryRaw`
    SELECT
        indexname,
        indexdef
    FROM
        pg_indexes
    WHERE
        tablename = 'RequirementRecord';
  `;
    for (const idx of result) {
        console.log(`Index: ${idx.indexname}`);
        console.log(`Def: ${idx.indexdef}`);
        console.log('---');
    }
}
main().finally(() => prisma.$disconnect());
