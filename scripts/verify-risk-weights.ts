import { prisma } from '../server/db/prisma';

async function main() {
    const riskNodes = await prisma.$queryRawUnsafe(`
    SELECT name, metadata 
    FROM graph_nodes 
    WHERE node_type = 'Risktyp'
    ORDER BY (metadata->>'baseWeight')::int DESC
  `);

    console.log('--- RISK NODES WITH WEIGHTS ---');
    console.log(riskNodes);

    const riskEdges = await prisma.$queryRawUnsafe(`
    SELECT e.relation_type, e.metadata, n_from.name as from_node, n_to.name as to_node
    FROM graph_edges e
    JOIN graph_nodes n_from ON e.source_node = n_from.node_id
    JOIN graph_nodes n_to ON e.target_node = n_to.node_id
    WHERE e.relation_type = 'handles_risk'
    LIMIT 5
  `);
    console.log('\n--- SAMPLE RISK EDGES ---');
    console.log(riskEdges);
}

main().catch(console.error).finally(() => prisma.$disconnect());
