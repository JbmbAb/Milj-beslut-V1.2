import { prisma } from '../db/prisma';
import { logger } from '../logger';

/**
 * Token Repository
 * Hanterar databaslagring av revokerade och använda JWT-tokens för att förhindra "token reuse".
 * Detta åtgärdar Priority 1-läckan där in-memory (Set) användes tidigare.
 */

/**
 * Kontrollerar om en specifik token (via dess JTI) har revokerats.
 */
export async function isTokenRevoked(jti: string, userId: string): Promise<boolean> {
  try {
    const record = await prisma.tokenRevocation.findFirst({
      where: { jti, userId },
    });

    return !!record;
  } catch (error) {
    logger.error('Failed to check token revocation status', { error: String(error), jti, userId });
    // Fail-safe: Om databasen ligger nere eller felet är oväntat antar vi att tokenen ÄR revokerad
    // för att förhindra potentiellt obehörig åtkomst (Zero Trust).
    return true;
  }
}

/**
 * Alias för att markera en Refresh Token som använd (för smidighet i auth.ts).
 */
export async function markRefreshTokenAsUsed(userId: string, jti: string, expiresAt: Date): Promise<void> {
  await revokeRefreshToken(userId, jti, expiresAt);
}

/**
 * Skriver in ett JTI (JWT ID) i databasen för att ogiltigförklara sessionen/tokenen.
 */
export async function revokeRefreshToken(userId: string, jti: string, expiresAt: Date): Promise<void> {
  try {
    await prisma.tokenRevocation.create({
      data: {
        jti,
        userId,
        expiresAt,
      },
    });
  } catch (error: any) {
    // P2002 = Unique constraint failed. Detta innebär att tokenen redan är revokerad. Vi kan ignorera detta.
    if (error?.code === 'P2002') return;

    logger.error('Failed to revoke token', { error: String(error), jti, userId });
    throw new Error('Kunde inte säkert revokera sessionen');
  }
}

/**
 * Rensar tokens vars utgångsdatum (expiresAt) har passerat.
 * Denna bör kallas i ett asynkront städjobb (t.ex. via gdprComplianceService.ts).
 */
export async function cleanupExpiredTokenRevocations(): Promise<number> {
  try {
    const result = await prisma.tokenRevocation.deleteMany({
      where: {
        expiresAt: { lt: new Date() },
      },
    });
    return result.count;
  } catch (error) {
    logger.error('Failed to cleanup expired token revocations', { error: String(error) });
    return 0;
  }
}

/**
 * Revokerar alla tokens för en användare.
 */
export async function revokeAllTokensForUser(userId: string): Promise<void> {
  try {
    await prisma.tokenRevocation.deleteMany({
      where: { userId },
    });
  } catch (error) {
    logger.error('Failed to revoke all tokens for user', { error: String(error), userId });
    throw new Error('Kunde inte revokera alla sessioner för användaren');
  }
}
