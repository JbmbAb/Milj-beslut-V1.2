
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    try {
        const tables: any[] = await prisma.$queryRaw`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'env' AND table_name LIKE 'sgu_%'
        `;
        
        console.log('--- SGU DATA STATUS ---');
        for (const row of tables) {
            const tableName = row.table_name;
            const countRes: any[] = await prisma.$queryRawUnsafe(`SELECT count(*) as count FROM env."${tableName}"`);
            const count = countRes[0].count;
            console.log(`${tableName}: ${count} rows`);
        }
        console.log('-----------------------');
    } catch (e) {
        console.error('Error fetching SGU counts:', e);
    } finally {
        await prisma.$disconnect();
    }
}

main();
