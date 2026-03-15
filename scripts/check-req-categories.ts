import { prisma } from '../server/db/prisma';

async function main() {
    const stats = await prisma.requirementRecord.groupBy({
        by: ['category'],
        _count: { id: true }
    });
    console.log('--- REQ CATEGORY STATS ---');
    stats.forEach(s => console.log(`${s.category || 'N/A'}: ${s._count.id}`));
}

main().catch(console.error).finally(() => prisma.$disconnect());
