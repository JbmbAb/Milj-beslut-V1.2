import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    const res = await prisma.$queryRawUnsafe("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name ILIKE '%topo%'");
    console.log(res);
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
