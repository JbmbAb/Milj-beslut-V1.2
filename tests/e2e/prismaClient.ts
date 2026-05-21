import { PrismaClient } from '@prisma/client';

const prismaDatabaseUrl =
  String(process.env.PLAYWRIGHT_DATABASE_URL || process.env.DATABASE_URL || '').trim() ||
  'postgresql://miljobeslut:miljobeslut@localhost:5432/miljobeslut_test';

type GlobalWithPrisma = typeof globalThis & {
  __playwrightPrisma?: PrismaClient;
};

const globalWithPrisma = globalThis as GlobalWithPrisma;

export const prisma =
  globalWithPrisma.__playwrightPrisma ||
  new PrismaClient({
    datasources: {
      db: {
        url: prismaDatabaseUrl,
      },
    },
  });

if (!globalWithPrisma.__playwrightPrisma) {
  globalWithPrisma.__playwrightPrisma = prisma;
}
