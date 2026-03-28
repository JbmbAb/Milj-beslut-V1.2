import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const r = await p.$queryRaw`SELECT nspname FROM pg_namespace;`;
  console.log(JSON.stringify(r));
}
main().finally(() => p.$disconnect());
