import { prisma } from '../server/db/prisma';

async function main() {
    const reqs = await prisma.requirementRecord.count();
    const citations = await prisma.requirementCitation.count();
    const cases = await prisma.requirementCase.count();
    const nodes = await prisma.$queryRawUnsafe('SELECT count(*) as count FROM graph_nodes');
    const edges = await prisma.$queryRawUnsafe('SELECT count(*) as count FROM graph_edges');

    console.log({ reqs, citations, cases, nodes, edges });
}

main().catch(console.error).finally(() => prisma.$disconnect());
