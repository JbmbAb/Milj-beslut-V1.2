import { PrismaClient } from '@prisma/client';
// U30F2 H1: the table names come from a query at run time; the protected relation gate checks each one.
import { gatedSql } from '../packages/spatial-provider-postgis/src/ProtectedRelationGate';
const prisma = new PrismaClient();

async function main() {
    const res = await prisma.$queryRawUnsafe<{table_name: string}[]>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND (table_name LIKE '%railway%' OR table_name LIKE '%bel_ggning%')`
    );
    for (const row of res) {
        console.log('Dropping', row.table_name);
        await prisma.$executeRawUnsafe(gatedSql('scripts/clean-road-data.ts', `DROP TABLE IF EXISTS "${row.table_name}" CASCADE`));
    }
    console.log('Done cleaning!');
}

main().finally(() => prisma.$disconnect());
