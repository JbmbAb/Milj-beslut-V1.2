import { prisma } from '../../db.server';

/**
 * Initiera alla databastabeller och seed med initial data
 */
export async function initializeDatabase() {
  try {
    console.log('🔄 Initialiserar databas...');

    // Skapa/uppdatera TokenRevocation tabell
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "TokenRevocation" (
        id SERIAL PRIMARY KEY,
        token_hash VARCHAR(255) NOT NULL UNIQUE,
        revoked_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        user_id VARCHAR(255) NOT NULL,
        reason VARCHAR(512)
      )
    `).catch(() => console.log('TokenRevocation tabell existerar redan'));

    // Skapa/uppdatera RateLimitEntry tabell
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "RateLimitEntry" (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(255) NOT NULL,
        endpoint VARCHAR(255) NOT NULL,
        request_count INT DEFAULT 1,
        window_start TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        window_end TIMESTAMP NOT NULL,
        UNIQUE(user_id, endpoint, window_start)
      )
    `).catch(() => console.log('RateLimitEntry tabell existerar redan'));

    // Skapa/uppdatera PropertyAccessAudit tabell
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "PropertyAccessAudit" (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(255) NOT NULL,
        project_id VARCHAR(255) NOT NULL,
        property_designation VARCHAR(512) NOT NULL,
        purpose VARCHAR(512),
        accessed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        response_class VARCHAR(50)
      )
    `).catch(() => console.log('PropertyAccessAudit tabell existerar redan'));

    console.log('✅ Databaskonfiguration slutförd');
    return true;
  } catch (error) {
    console.error('❌ Fel vid databaskonfiguration:', error);
    throw error;
  }
}

/**
 * Rensa databas (för testning)
 */
export async function cleanDatabase() {
  try {
    console.log('🗑️ Rensar databas...');
    
    // Radera i rätt ordning för FK-constraints
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "PropertyAccessAudit" CASCADE');
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "RateLimitEntry" CASCADE');
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "TokenRevocation" CASCADE');
    
    console.log('✅ Databas rensakad');
  } catch (error) {
    console.error('❌ Fel vid rensning:', error);
  }
}

/**
 * Kontrollera databasanslutning
 */
export async function healthCheck(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}