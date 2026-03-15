
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
    const d = await prisma.documentRecord.findFirst({
        where: { id: { startsWith: 'cmmfujkp' } }
    });
    console.log(JSON.stringify(d, (k, v) => typeof v === 'bigint' ? v.toString() : v, 2));
}
main().finally(() => prisma.$disconnect());
