import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('--- MUNICIPALITY INVENTORY ---');
  
  // 1. Unique municipalities in DocumentRecord
  const docMunis = await prisma.documentRecord.groupBy({
    by: ['municipality'],
    _count: true
  });
  
  // 2. Unique municipalities in RequirementCase
  const caseMunis = await prisma.requirementCase.groupBy({
    by: ['municipality'],
    _count: true
  });

  // 3. Count in graph_nodes
  let graphMunis = 0;
  try {
    const result: any = await prisma.$queryRawUnsafe("SELECT COUNT(*) FROM graph_nodes WHERE node_type = 'Kommun'");
    graphMunis = Number(result[0].count);
  } catch {
    console.log('Knowledge Graph tables not available.');
  }

  const allNames = new Set([
    ...docMunis.map(m => m.municipality).filter(Boolean),
    ...caseMunis.map(m => m.municipality).filter(Boolean)
  ]);

  console.log(`Unique municipalities (distinct names): ${allNames.size}`);
  console.log(`DocumentRecord covers: ${docMunis.filter(m => m.municipality).length} municipalities`);
  console.log(`RequirementCase covers: ${caseMunis.filter(m => m.municipality).length} municipalities`);
  console.log(`Graph 'Kommun' nodes: ${graphMunis}`);
  
  if (allNames.size > 0) {
    console.log('Sample names: ' + Array.from(allNames).slice(0, 5).join(', '));
  }
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
