import { PrismaClient } from '@prisma/client';
import { withAccelerate } from '@prisma/extension-accelerate';

const prismaClientSingleton = (): PrismaClient => {
  const dbUrl = process.env.DATABASE_URL || '';
  const isAccelerate = dbUrl.startsWith('prisma');
  const isProduction = process.env.NODE_ENV === 'production';

  // ──── CONNECTION POOLING & SSL CONFIGURATION ────────────────────────────
  // Production: Aggressive pooling with SSL requirement
  // Development: Moderate pooling with optional SSL
  // These settings apply to both direct PostgreSQL and Cloud SQL connections
  const connectionConfig = {
    // Socket/connection timeout (in seconds)
    connect_timeout: isProduction ? 15 : 10,
    // Maximum connections in pool (Prisma default ~2, insufficient for production)
    pool_size: isProduction ? 15 : 5,
    // Idle connection timeout (in seconds) - reclaim unused connections
    idle_in_transaction_session_timeout: '15000', // 15 seconds
    // Statement timeout (in milliseconds) - prevent runaway queries
    statement_timeout: '60000', // 60 seconds max query time
  };

  if (isAccelerate) {
    // Prisma Accelerate uses a `prisma://` datasource URL.
    // We cast to `PrismaClient` to avoid union types leaking into the app when Accelerate is enabled.
    return new PrismaClient({ log: ['warn', 'error'], accelerateUrl: dbUrl } as any).$extends(
      withAccelerate(),
    ) as unknown as PrismaClient;
  }

  // Build DATABASE_URL with SSL + pool configuration
  let finalUrl = dbUrl;
  if (dbUrl && !dbUrl.includes('sslmode')) {
    try {
      const urlObj = new URL(dbUrl);

      // Configure SSL mode based on environment
      if (isProduction) {
        // Production: Require SSL/TLS encryption
        urlObj.searchParams.set('sslmode', 'require');
      } else if (process.env.DATABASE_SSL === 'true') {
        // Development: Force SSL if explicitly requested
        urlObj.searchParams.set('sslmode', 'require');
      } else {
        // Development: Prefer SSL but allow fallback to unencrypted
        urlObj.searchParams.set('sslmode', 'prefer');
      }

      // Add connection pool & timeout settings
      Object.entries(connectionConfig).forEach(([key, value]) => {
        if (!urlObj.searchParams.has(key)) {
          urlObj.searchParams.set(key, String(value));
        }
      });

      finalUrl = urlObj.toString();
    } catch (error) {
      console.warn('⚠️  Failed to parse DATABASE_URL for SSL/pool config:', error);
      // Fall back to original URL if parsing fails
    }
  }

  // Prisma Client with configured connection pooling
  return new PrismaClient({
    log: ['warn', 'error'],
    ...(finalUrl && { datasources: { db: { url: finalUrl } } }),
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
