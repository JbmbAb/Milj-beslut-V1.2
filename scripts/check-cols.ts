
import { prisma } from '../server/db/prisma';

async function main() {
    const columns = await prisma.$queryRaw`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = 'DocumentRecord'
        ORDER BY column_name;
    `;
    console.log(JSON.stringify(columns, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
