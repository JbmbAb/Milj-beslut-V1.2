import { prisma } from '../server/db/prisma';

async function main() {
    const reqsWithNullMuni = await prisma.requirementRecord.count({
        where: {
            case: { municipality: null }
        }
    });
    const totalReqs = await prisma.requirementRecord.count();
    console.log(`Requirements with no case municipality: ${reqsWithNullMuni} / ${totalReqs}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
