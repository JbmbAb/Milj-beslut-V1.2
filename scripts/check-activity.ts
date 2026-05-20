import { prisma } from '../server/db/prisma';

async function main() {
    const withActivity = await prisma.documentRecord.count({ where: { activityCode: { not: null } } });
    const total = await prisma.documentRecord.count();
    console.log(`Progress: ${withActivity} / ${total} documents have activity code.`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
