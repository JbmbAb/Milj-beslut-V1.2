import { prisma } from '../server/db/prisma';

async function main() {
  // Uppdaterat till nya Prisma-specifikationer: 'knowledge_nodes' istället för 'graph_nodes'.
  // 'node_type' för risker kallas numer 'RISK' istället för 'Risktyp'.
  const riskNodes = await prisma.$queryRawUnsafe(`
    SELECT name, metadata 
    FROM knowledge_nodes 
    WHERE node_type = 'RISK'
    ORDER BY (metadata->>'baseWeight')::int DESC
  `);

  console.log('--- RISK NODES WITH WEIGHTS ---');
  console.log(riskNodes);

  // Uppdaterat för knowledge_edges: relation_type är numer 'relation', source_node = source_id, target_node = target_id
  const riskEdges = await prisma.$queryRawUnsafe(`
    SELECT e.relation, e.metadata, n_from.name as from_node, n_to.name as to_node
    FROM knowledge_edges e
    JOIN knowledge_nodes n_from ON e.source_id = n_from.id
    JOIN knowledge_nodes n_to ON e.target_id = n_to.id
    WHERE e.relation = 'handles_risk'
    LIMIT 5
  `);
  
  console.log('\n--- SAMPLE RISK EDGES ---');
  console.log(riskEdges);
}

main().catch(console.error).finally(() => prisma.$disconnect());
