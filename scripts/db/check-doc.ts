import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const d = await prisma.documentRecord.findFirst();
  console.log('Doc:', JSON.stringify(d, null, 2));
  const p = await prisma.project.findFirst({ where: { id: d?.projectId } });
  console.log('Project:', JSON.stringify(p, null, 2));
}
main().finally(() => prisma.$disconnect());
