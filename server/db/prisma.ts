import { PrismaClient } from '@prisma/client';
import { withAccelerate } from '@prisma/extension-accelerate';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { loadEnvFile } from '../loadEnv';

// Bulletproof check: Ensure environment variables are loaded before client singleton evaluates
if (!process.env.DATABASE_URL) {
  loadEnvFile();
  const preserveRuntimeEnv =
    process.env.PRESERVE_RUNTIME_ENV === 'true' ||
    Boolean(process.env.PLAYWRIGHT_LOCAL_API_PORT) ||
    process.env.NODE_ENV === 'test';
  loadEnvFile('.env.local', { overrideExisting: !preserveRuntimeEnv });
}

const prismaClientSingleton = (): PrismaClient => {
  const dbUrl = process.env.DATABASE_URL || '';
  const isAccelerate = dbUrl.startsWith('prisma');
  const isProduction = process.env.NODE_ENV === 'production';
  const isTest = process.env.NODE_ENV === 'test';

  // ──── CONNECTION POOLING CONFIGURATION ────────────────────────────
  const connectionConfig = {
    // Socket/connection timeout (in milliseconds)
    connectionTimeoutMillis: isProduction ? 15000 : 10000,
    // Maximum connections in pool (Vitest safe pool limit)
    max: isProduction ? 15 : (isTest ? 1 : 5),
    // Idle connection timeout (in milliseconds) - reclaim unused connections
    idleTimeoutMillis: isProduction ? 15000 : 5000, // 5 seconds in development/testing to release quickly
  };

  if (isAccelerate) {
    return new PrismaClient({ log: ['warn', 'error'], accelerateUrl: dbUrl } as any).$extends(
      withAccelerate(),
    ) as unknown as PrismaClient;
  }

  // Build DATABASE_URL with SSL configuration
  let finalUrl = dbUrl;
  if (dbUrl && !dbUrl.includes('sslmode')) {
    try {
      const urlObj = new URL(dbUrl);

      // Configure SSL mode based on environment
      if (isProduction) {
        urlObj.searchParams.set('sslmode', 'require');
      } else if (process.env.DATABASE_SSL === 'true') {
        urlObj.searchParams.set('sslmode', 'require');
      } else {
        urlObj.searchParams.set('sslmode', 'prefer');
      }

      finalUrl = urlObj.toString();
    } catch (error) {
      console.warn('⚠️  Failed to parse DATABASE_URL for SSL config:', error);
    }
  }

  if (finalUrl) {
    process.env.DATABASE_URL = finalUrl;
  }

  // Create pg connection pool and wrap it in standard Prisma Pg Adapter
  const pool = new pg.Pool({
    connectionString: finalUrl,
    ...connectionConfig,
  });
  const adapter = new PrismaPg(pool);

  return new PrismaClient({
    log: ['warn', 'error'],
    adapter,
  });
};

declare global {
  var __miljobeslutPrisma: PrismaClient | undefined;
}

export { Prisma } from '@prisma/client';

export const prisma = (globalThis.__miljobeslutPrisma ?? prismaClientSingleton()) as PrismaClient;

if (process.env.NODE_ENV !== 'production') {
  globalThis.__miljobeslutPrisma = prisma;
}
