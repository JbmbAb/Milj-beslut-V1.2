import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const p = await prisma.project.findUnique({ where: { id: 'clv1234dummyproj' } });
  const o = await prisma.organisation.findUnique({ where: { id: 'clv1234dummyorg' } });
  console.log('Project:', p?.id);
  console.log('Org:', o?.id);
}
main().finally(() => prisma.$disconnect());
