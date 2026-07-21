import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    const res = await prisma.$queryRawUnsafe<{table_name: string}[]>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND (table_name LIKE '%railway%' OR table_name LIKE '%bel_ggning%')`
    );
    for (const row of res) {
        console.log('Dropping', row.table_name);
        await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${row.table_name}" CASCADE`);
    }
    console.log('Done cleaning!');
}

main().finally(() => prisma.$disconnect());
