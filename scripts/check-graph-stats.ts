import { prisma } from '../server/db/prisma';

async function main() {
    const nodeCount = await prisma.$queryRawUnsafe('SELECT count(*) as count FROM graph_nodes');
    const edgeCount = await prisma.$queryRawUnsafe('SELECT count(*) as count FROM graph_edges');
    const run = await prisma.$queryRawUnsafe('SELECT * FROM graph_runs ORDER BY started_at DESC LIMIT 1');
    console.log({ nodeCount, edgeCount, run });
}

main().catch(console.error).finally(() => prisma.$disconnect());
