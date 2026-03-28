import { beforeEach, describe, expect, it, vi } from 'vitest';

const prisma = vi.hoisted(() => ({
  tokenRevocation: {
    create: vi.fn(),
    upsert: vi.fn(),
    findUnique: vi.fn(),
    deleteMany: vi.fn(),
  },
}));

vi.mock('../../server/db/prisma', () => ({ prisma }));

import {
  cleanupExpiredTokenRevocations,
  isTokenRevoked,
  markRefreshTokenAsUsed,
  revokeAllTokensForUser,
  revokeRefreshToken,
} from '../../server/repositories/tokenRepository';

describe('tokenRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a revocation record for a refresh token', async () => {
    prisma.tokenRevocation.create.mockResolvedValue({ id: 'revocation-1' });

    const expiresAt = new Date('2026-03-22T10:00:00.000Z');
    await revokeRefreshToken('user-1', 'jti-1', expiresAt);

    expect(prisma.tokenRevocation.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        jti: 'jti-1',
        expiresAt,
      },
    });
  });

  it('upserts a wildcard revocation record for all user tokens', async () => {
    prisma.tokenRevocation.upsert.mockResolvedValue({ id: 'revocation-2' });

    const expiresAt = new Date('2026-03-22T11:00:00.000Z');
    await revokeAllTokensForUser('user-2', expiresAt);

    expect(prisma.tokenRevocation.upsert).toHaveBeenCalledWith({
      where: { jti: 'ALL:user-2' },
      create: {
        userId: 'user-2',
        jti: 'ALL:user-2',
        expiresAt,
      },
      update: {
        expiresAt,
      },
    });
  });

  it('returns false when a token is not revoked and no user wildcard is checked', async () => {
    prisma.tokenRevocation.findUnique.mockResolvedValue(null);

    await expect(isTokenRevoked('jti-2')).resolves.toBe(false);
    expect(prisma.tokenRevocation.findUnique).toHaveBeenCalledTimes(1);
    expect(prisma.tokenRevocation.findUnique).toHaveBeenCalledWith({
      where: { jti: 'jti-2' },
    });
  });

  it('returns true when the token itself is revoked', async () => {
    prisma.tokenRevocation.findUnique
      .mockResolvedValueOnce({ id: 'revocation-3' })
      .mockResolvedValueOnce(null);

    await expect(isTokenRevoked('jti-3', 'user-3')).resolves.toBe(true);
    expect(prisma.tokenRevocation.findUnique).toHaveBeenNthCalledWith(1, {
      where: { jti: 'jti-3' },
    });
    expect(prisma.tokenRevocation.findUnique).toHaveBeenNthCalledWith(2, {
      where: { jti: 'ALL:user-3' },
    });
  });

  it('returns true when a user wildcard revocation exists', async () => {
    prisma.tokenRevocation.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'revocation-4' });

    await expect(isTokenRevoked('jti-4', 'user-4')).resolves.toBe(true);
  });

  it('marks a refresh token as used by revoking it', async () => {
    prisma.tokenRevocation.create.mockResolvedValue({ id: 'revocation-5' });

    const expiresAt = new Date('2026-03-22T12:00:00.000Z');
    await markRefreshTokenAsUsed('user-5', 'jti-5', expiresAt);

    expect(prisma.tokenRevocation.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-5',
        jti: 'jti-5',
        expiresAt,
      },
    });
  });

  it('deletes expired revocations and returns the deleted count', async () => {
    prisma.tokenRevocation.deleteMany.mockResolvedValue({ count: 7 });

    await expect(cleanupExpiredTokenRevocations()).resolves.toBe(7);
    expect(prisma.tokenRevocation.deleteMany).toHaveBeenCalledWith({
      where: {
        expiresAt: {
          lt: expect.any(Date),
        },
      },
    });
  });
});
