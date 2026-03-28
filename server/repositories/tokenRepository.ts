import { prisma } from "../db/prisma";

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

export async function isTokenRevoked(jti: string, userId?: string): Promise<boolean> {
  const checks = [
    prisma.tokenRevocation.findUnique({ where: { jti } })
  ];

  if (userId) {
    checks.push(prisma.tokenRevocation.findUnique({ where: { jti: `ALL:${userId}` } }));
  }

  const results = await Promise.all(checks);
  return results.some(r => !!r);
}

/**
 * Records a refresh token as used for reuse detection.
 * This prevents token reuse attacks during rotation.
 */
export async function markRefreshTokenAsUsed(userId: string, jti: string, expiresAt: Date): Promise<void> {
  await revokeRefreshToken(userId, jti, expiresAt);
}

/**
 * Revokes all tokens for a user by creating a wildcard revocation record.
 * This requires the auth middleware to check for user-level revocation.
 * For now, we'll implement it by revoking a special 'ALL' jti.
 */
export async function revokeAllTokensForUser(userId: string, expiresAt: Date): Promise<void> {
  await prisma.tokenRevocation.upsert({
    where: { jti: `ALL:${userId}` },
    create: {
      userId,
      jti: `ALL:${userId}`,
      expiresAt,
    },
    update: {
      expiresAt,
    },
  });
}

export async function revokeRefreshToken(userId: string, jti: string, expiresAt: Date): Promise<void> {
  await prisma.tokenRevocation.create({
    data: {
      userId,
      jti,
      expiresAt,
    },
  });
}
