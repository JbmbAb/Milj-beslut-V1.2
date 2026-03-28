import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('--- FINAL DATABASE INVENTORY ---');
  
  const documents = await prisma.documentRecord.count();
  const chunks = await prisma.documentChunk.count();
  const requirements = await prisma.requirementRecord.count();
  const citations = await prisma.requirementCitation.count();
  
  let graphNodes = '0';
  let graphEdges = '0';
  
  try {
    const nodes: any = await prisma.$queryRawUnsafe('SELECT COUNT(*) FROM graph_nodes');
    const edges: any = await prisma.$queryRawUnsafe('SELECT COUNT(*) FROM graph_edges');
    graphNodes = nodes[0].count.toString();
    graphEdges = edges[0].count.toString();
  } catch {
    console.log('Graph tables not found or accessible yet.');
  }

  const totalNodes = Number(documents) + Number(chunks) + Number(requirements) + Number(citations) + Number(graphNodes);

  console.log(`Documents: ${documents}`);
  console.log(`Document Chunks: ${chunks}`);
  console.log(`Requirement Rows: ${requirements}`);
  console.log(`Requirement Citations: ${citations}`);
  console.log(`Graph Nodes: ${graphNodes}`);
  console.log(`Graph Edges: ${graphEdges}`);
  console.log('----------------------------');
  console.log(`TOTAL CALCULATED NODES: ${totalNodes}`);
  
  if (totalNodes >= 130000) {
    console.log('TARGET REACHED: 130,000+ NODES');
  } else {
    console.log(`TARGET REMAINING: ${130000 - totalNodes} nodes`);
  }
  
  if (requirements >= 41000) {
    console.log('TARGET REACHED: 41,000+ REQUIREMENTS');
  } else {
    console.log(`TARGET REMAINING: ${41000 - requirements} requirements`);
  }
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
