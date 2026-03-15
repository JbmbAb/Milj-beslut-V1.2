
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
    const r: any[] = await prisma.$queryRawUnsafe("SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public'");
    console.log(r.map(t => t.tablename));
}
main().finally(() => prisma.$disconnect());
