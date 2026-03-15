
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
    try {
        const res = await prisma.requirementRecord.findMany({ take: 5 });
        console.log(JSON.stringify(res, null, 2));
    } catch (e) {
        console.error(e);
    }
}
main().finally(() => prisma.$disconnect());
