
import { prisma } from '../server/db/prisma';

async function main() {
    const runs = await prisma.pipelineRun.findMany({
        orderBy: { startedAt: 'desc' },
        take: 5
    });
    console.log(JSON.stringify(runs, (k, v) => typeof v === 'bigint' ? v.toString() : v, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
