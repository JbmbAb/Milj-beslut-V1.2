import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Prisma mock ─────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  tokenRevocationCreate: vi.fn(),
  tokenRevocationFindUnique: vi.fn(),
  tokenRevocationUpsert: vi.fn(),
  tokenRevocationDeleteMany: vi.fn(),
}));

vi.mock('../../server/db/prisma', () => ({
  prisma: {
    tokenRevocation: {
      create: mocks.tokenRevocationCreate,
      findUnique: mocks.tokenRevocationFindUnique,
      upsert: mocks.tokenRevocationUpsert,
      deleteMany: mocks.tokenRevocationDeleteMany,
    },
  },
}));

import {
  cleanupExpiredTokenRevocations,
  isTokenRevoked,
  markRefreshTokenAsUsed,
  revokeAllTokensForUser,
  revokeRefreshToken,
} from '../../server/repositories/tokenRepository';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('tokenRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── revokeRefreshToken ───────────────────────────────────────────────────

  describe('revokeRefreshToken', () => {
    it('creates a token revocation record', async () => {
      mocks.tokenRevocationCreate.mockResolvedValue({ id: 'rev-1' });
      const expiresAt = new Date(Date.now() + 86_400_000);

      await revokeRefreshToken('user-1', 'jti-abc', expiresAt);

      expect(mocks.tokenRevocationCreate).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          jti: 'jti-abc',
          expiresAt,
        },
      });
    });

    it('propagates DB errors', async () => {
      mocks.tokenRevocationCreate.mockRejectedValue(new Error('DB write failed'));

      await expect(revokeRefreshToken('user-1', 'jti-x', new Date())).rejects.toThrow('DB write failed');
    });
  });

  // ── revokeAllTokensForUser ────────────────────────────────────────────────

  describe('revokeAllTokensForUser', () => {
    it('upserts an ALL:<userId> wildcard revocation', async () => {
      mocks.tokenRevocationUpsert.mockResolvedValue({ id: 'rev-all' });
      const expiresAt = new Date(Date.now() + 86_400_000);

      await revokeAllTokensForUser('user-1', expiresAt);

      expect(mocks.tokenRevocationUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { jti: 'ALL:user-1' },
          create: expect.objectContaining({ jti: 'ALL:user-1', userId: 'user-1' }),
          update: expect.objectContaining({ expiresAt }),
        }),
      );
    });
  });

  // ── isTokenRevoked ────────────────────────────────────────────────────────

  describe('isTokenRevoked', () => {
    it('returns true when specific jti is revoked', async () => {
      mocks.tokenRevocationFindUnique.mockResolvedValue({ jti: 'jti-abc' });

      const result = await isTokenRevoked('jti-abc');

      expect(result).toBe(true);
    });

    it('returns false when jti is not revoked and no userId given', async () => {
      mocks.tokenRevocationFindUnique.mockResolvedValue(null);

      const result = await isTokenRevoked('jti-unknown');

      expect(result).toBe(false);
    });

    it('returns true when ALL:<userId> wildcard is present', async () => {
      mocks.tokenRevocationFindUnique.mockImplementation(async ({ where }: { where: { jti: string } }) => {
        if (where.jti === 'ALL:user-1') return { jti: 'ALL:user-1' };
        return null;
      });

      const result = await isTokenRevoked('jti-xyz', 'user-1');

      expect(result).toBe(true);
    });

    it('returns false when neither specific nor wildcard record exists', async () => {
      mocks.tokenRevocationFindUnique.mockResolvedValue(null);

      const result = await isTokenRevoked('jti-none', 'user-1');

      expect(result).toBe(false);
    });

    it('checks both specific jti and ALL wildcard when userId is provided', async () => {
      mocks.tokenRevocationFindUnique.mockResolvedValue(null);

      await isTokenRevoked('jti-check', 'user-99');

      // Two separate findUnique calls: one for jti, one for ALL:<userId>
      expect(mocks.tokenRevocationFindUnique).toHaveBeenCalledTimes(2);
    });

    it('only checks specific jti when no userId is provided', async () => {
      mocks.tokenRevocationFindUnique.mockResolvedValue(null);

      await isTokenRevoked('jti-only');

      expect(mocks.tokenRevocationFindUnique).toHaveBeenCalledTimes(1);
    });
  });

  // ── markRefreshTokenAsUsed ────────────────────────────────────────────────

  describe('markRefreshTokenAsUsed', () => {
    it('delegates to revokeRefreshToken (token reuse prevention)', async () => {
      mocks.tokenRevocationCreate.mockResolvedValue({ id: 'rev-2' });
      const expiresAt = new Date();

      await markRefreshTokenAsUsed('user-1', 'jti-used', expiresAt);

      // Same underlying call as revokeRefreshToken
      expect(mocks.tokenRevocationCreate).toHaveBeenCalledWith({
        data: { userId: 'user-1', jti: 'jti-used', expiresAt },
      });
    });
  });

  // ── cleanupExpiredTokenRevocations ───────────────────────────────────────

  describe('cleanupExpiredTokenRevocations', () => {
    it('deletes expired records and returns count', async () => {
      mocks.tokenRevocationDeleteMany.mockResolvedValue({ count: 7 });

      const count = await cleanupExpiredTokenRevocations();

      expect(count).toBe(7);
      expect(mocks.tokenRevocationDeleteMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { expiresAt: { lt: expect.any(Date) } },
        }),
      );
    });

    it('returns 0 when no records expired', async () => {
      mocks.tokenRevocationDeleteMany.mockResolvedValue({ count: 0 });

      const count = await cleanupExpiredTokenRevocations();

      expect(count).toBe(0);
    });
  });
});
