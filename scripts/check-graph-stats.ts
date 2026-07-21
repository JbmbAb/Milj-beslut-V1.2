import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const nodes = await prisma.knowledgeNode.count();
  const edges = await prisma.knowledgeEdge.count();
  const nodeTypes = await prisma.knowledgeNode.groupBy({
    by: ['nodeType'],
    _count: { id: true }
  });
  console.log(JSON.stringify({ nodes, edges, nodeTypes }));
}
main().catch(console.error).finally(() => prisma.$disconnect());
