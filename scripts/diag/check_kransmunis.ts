import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  const munis = ['Mariestad', 'Skövde', 'Skövde', 'Töreboda', 'Gullspång', 'Götene', 'Lidköping'];
  try {
    const results: Record<string, number> = {};
    for (const muni of munis) {
       const count = await prisma.documentContent.count({
         where: { searchText: { contains: muni, mode: 'insensitive' } }
       });
       results[muni] = count;
    }
    console.log(results);
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}
main();
