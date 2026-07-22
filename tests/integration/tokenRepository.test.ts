import { prisma } from '../../server/db/prisma';
import { it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import {
  cleanupExpiredTokenRevocations,
  isTokenRevoked,
  markRefreshTokenAsUsed,
  revokeAllTokensForUser,
  revokeRefreshToken,
} from '../../server/repositories/tokenRepository';
import { describeIfDatabaseIntegration } from './integrationTestEnv';



describeIfDatabaseIntegration('tokenRepository Integration', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Clean up the TokenRevocation table before each test
    await prisma.tokenRevocation.deleteMany({});
  });

  it('should revoke a specific refresh token', async () => {
    const userId = 'user123';
    const jti = 'jti-specific-1';
    const expiresAt = new Date(Date.now() + 3600 * 1000); // 1 hour from now

    await revokeRefreshToken(userId, jti, expiresAt);

    const revoked = await isTokenRevoked(jti, userId);
    expect(revoked).toBe(true);

    const notRevoked = await isTokenRevoked('jti-non-existent', userId);
    expect(notRevoked).toBe(false);
  });

  it('should mark a refresh token as used (which revokes it)', async () => {
    const userId = 'user456';
    const jti = 'jti-used-1';
    const expiresAt = new Date(Date.now() + 3600 * 1000);

    await markRefreshTokenAsUsed(userId, jti, expiresAt);

    const revoked = await isTokenRevoked(jti, userId);
    expect(revoked).toBe(true);
  });

  it('should revoke all tokens for a user by deleting them', async () => {
    const userId = 'user789';
    const jti1 = 'jti-user789-1';
    const jti2 = 'jti-user789-2';
    const expiresAt = new Date(Date.now() + 3600 * 1000);

    // Create some specific tokens for the user
    await revokeRefreshToken(userId, jti1, expiresAt);
    await revokeRefreshToken(userId, jti2, expiresAt);

    // Verify they are there
    expect(await isTokenRevoked(jti1, userId)).toBe(true);
    expect(await isTokenRevoked(jti2, userId)).toBe(true);

    // Revoke all tokens for the user
    await revokeAllTokensForUser(userId);

    // Should be gone now
    expect(await isTokenRevoked(jti1, userId)).toBe(false);
    expect(await isTokenRevoked(jti2, userId)).toBe(false);
  });

  it('should clean up expired token revocations', async () => {
    const now = new Date();
    const expiredJti = 'jti-expired';
    const nonExpiredJti = 'jti-non-expired';

    // Create an expired token
    await prisma.tokenRevocation.create({
      data: { userId: 'user-expired', jti: expiredJti, expiresAt: new Date(now.getTime() - 1000) },
    });
    // Create a non-expired token
    await prisma.tokenRevocation.create({
      data: {
        userId: 'user-non-expired',
        jti: nonExpiredJti,
        expiresAt: new Date(now.getTime() + 3600 * 1000),
      },
    });

    const cleanedCount = await cleanupExpiredTokenRevocations();
    expect(cleanedCount).toBe(1);
    expect(await prisma.tokenRevocation.count()).toBe(1);
    expect(await isTokenRevoked(nonExpiredJti, 'user-non-expired')).toBe(true);
  });
});
