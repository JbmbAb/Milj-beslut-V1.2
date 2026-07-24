import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

const prismaDatabaseUrl =
  String(process.env.PLAYWRIGHT_DATABASE_URL || process.env.DATABASE_URL || '').trim() ||
  'postgresql://miljobeslut:miljobeslut@localhost:5432/miljobeslut_test';

type GlobalWithPrisma = typeof globalThis & {
  __playwrightPrisma?: PrismaClient;
  __playwrightPgPool?: pg.Pool;
};

const globalWithPrisma = globalThis as GlobalWithPrisma;

function createPrismaClient(): PrismaClient {
  process.env.DATABASE_URL = prismaDatabaseUrl;
  const pool =
    globalWithPrisma.__playwrightPgPool ??
    new pg.Pool({
      connectionString: prismaDatabaseUrl,
      ssl: false,
      max: 5,
    });
  globalWithPrisma.__playwrightPgPool = pool;
  const adapter = new PrismaPg(pool);
  return new PrismaClient({
    log: ['warn', 'error'],
    adapter,
  });
}

export const prisma = globalWithPrisma.__playwrightPrisma ?? createPrismaClient();

if (!globalWithPrisma.__playwrightPrisma) {
  globalWithPrisma.__playwrightPrisma = prisma;
}
