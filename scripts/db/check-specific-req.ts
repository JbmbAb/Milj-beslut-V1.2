
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
    const r = await prisma.requirementRecord.findUnique({
        where: { requirementCode: 'REQ-4c92301c64fb82bf128e856c' }
    });
    console.log('Result:', JSON.stringify(r, null, 2));
}
main().finally(() => prisma.$disconnect());
