import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  const munis = ['Mariestad', 'Skövde', 'Töreboda', 'Gullspång', 'Götene', 'Lidköping'];
  try {
    const docIds = await prisma.documentContent.findMany({
      where: {
        OR: munis.map(m => ({ searchText: { contains: m, mode: 'insensitive' } }))
      },
      select: { documentId: true }
    });
    const ids = docIds.map(d => d.documentId);
    if (ids.length === 0) return;
    
    const reqCount = await prisma.requirementRecord.count({
      where: { documentId: { in: ids } }
    });
    
    console.log('Total documents:', ids.length);
    console.log('Total extracted requirements:', reqCount);
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}
main();
