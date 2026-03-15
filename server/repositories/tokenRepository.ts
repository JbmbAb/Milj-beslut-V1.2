import { prisma } from "../db/prisma";

export async function revokeRefreshToken(userId: string, jti: string, expiresAt: Date): Promise<void> {
  await prisma.tokenRevocation.create({
    data: {
      userId,
      jti,
      expiresAt,
    },
  });
}

export async function isTokenRevoked(jti: string): Promise<boolean> {
  const revocation = await prisma.tokenRevocation.findUnique({
    where: { jti },
  });
  return !!revocation;
}

/**
 * Records a refresh token as used for reuse detection.
 * This prevents token reuse attacks during rotation.
 */
export async function markRefreshTokenAsUsed(userId: string, jti: string, expiresAt: Date): Promise<void> {
  await revokeRefreshToken(userId, jti, expiresAt);
}

/**
 * Clean up expired token revocations (GDPR compliance).
 * Runs periodically to free up space in the database.
 */
export async function cleanupExpiredTokenRevocations(): Promise<number> {
  const result = await prisma.tokenRevocation.deleteMany({
    where: {
      expiresAt: {
        lt: new Date(),
      },
    },
  });
  return result.count;
}
