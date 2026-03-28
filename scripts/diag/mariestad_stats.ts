import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  try {
    const docIds = await prisma.documentContent.findMany({
      where: { searchText: { contains: 'Mariestad', mode: 'insensitive' } },
      select: { documentId: true }
    });
    const ids = docIds.map(d => d.documentId);
    
    const stats = await prisma.requirementRecord.groupBy({
      by: ['category'],
      where: { documentId: { in: ids } },
      _count: true,
      orderBy: { _count: { id: 'desc' } }
    });
    console.log('Categories for Mariestad:', stats);
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}
main();
