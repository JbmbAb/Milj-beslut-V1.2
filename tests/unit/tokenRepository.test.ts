import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  tokenRevocationCreate: vi.fn(),
  tokenRevocationFindFirst: vi.fn(),
  tokenRevocationDeleteMany: vi.fn(),
}));

vi.mock('../../server/db/prisma', () => ({
  prisma: {
    tokenRevocation: {
      create: mocks.tokenRevocationCreate,
      findFirst: mocks.tokenRevocationFindFirst,
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

beforeEach(() => {
  vi.resetAllMocks();
});

describe('revokeRefreshToken', () => {
  it('creates a token revocation record with the provided fields', async () => {
    mocks.tokenRevocationCreate.mockResolvedValue(undefined);

    const expiresAt = new Date('2027-01-01T00:00:00Z');
    await revokeRefreshToken('user-1', 'jti-abc', expiresAt);

    expect(mocks.tokenRevocationCreate).toHaveBeenCalledOnce();
    expect(mocks.tokenRevocationCreate).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        jti: 'jti-abc',
        expiresAt,
      },
    });
  });

  it('propagates prisma errors', async () => {
    mocks.tokenRevocationCreate.mockRejectedValue(new Error('unique constraint'));

    await expect(revokeRefreshToken('user-1', 'jti-dup', new Date())).rejects.toThrow(
      'Kunde inte säkert revokera sessionen',
    );
  });
});

describe('revokeAllTokensForUser', () => {
  it('deletes all records for the specified user', async () => {
    mocks.tokenRevocationDeleteMany.mockResolvedValue({ count: 5 });

    await revokeAllTokensForUser('user-42');

    expect(mocks.tokenRevocationDeleteMany).toHaveBeenCalledOnce();
    expect(mocks.tokenRevocationDeleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-42' },
    });
  });

  it('handles database errors during user-level revocation', async () => {
    mocks.tokenRevocationDeleteMany.mockRejectedValue(new Error('delete failed'));

    await expect(revokeAllTokensForUser('user-fail')).rejects.toThrow(
      'Kunde inte revokera alla sessioner för användaren',
    );
  });
});

describe('isTokenRevoked', () => {
  it('returns true when a matching record is found', async () => {
    mocks.tokenRevocationFindFirst.mockResolvedValue({ jti: 'jti-bad', userId: 'user-1' });

    const result = await isTokenRevoked('jti-bad', 'user-1');

    expect(result).toBe(true);
    expect(mocks.tokenRevocationFindFirst).toHaveBeenCalledWith({
      where: { jti: 'jti-bad', userId: 'user-1' },
    });
  });

  it('returns false when no matching record is found', async () => {
    mocks.tokenRevocationFindFirst.mockResolvedValue(null);

    const result = await isTokenRevoked('jti-ok', 'user-1');

    expect(result).toBe(false);
  });

  it('returns true when an error occurs during lookup (fail-safe)', async () => {
    mocks.tokenRevocationFindFirst.mockRejectedValue(new Error('lookup failed'));

    const result = await isTokenRevoked('jti-any', 'user-any');

    expect(result).toBe(true);
  });
});

describe('markRefreshTokenAsUsed', () => {
  it('delegates to revokeRefreshToken by creating a revocation record', async () => {
    mocks.tokenRevocationCreate.mockResolvedValue(undefined);

    const expiresAt = new Date('2027-03-01T00:00:00Z');
    await markRefreshTokenAsUsed('user-9', 'jti-used', expiresAt);

    expect(mocks.tokenRevocationCreate).toHaveBeenCalledOnce();
    expect(mocks.tokenRevocationCreate).toHaveBeenCalledWith({
      data: {
        userId: 'user-9',
        jti: 'jti-used',
        expiresAt,
      },
    });
  });
});

describe('cleanupExpiredTokenRevocations', () => {
  it('deletes revocations whose expiresAt is in the past and returns the count', async () => {
    mocks.tokenRevocationDeleteMany.mockResolvedValue({ count: 7 });

    const result = await cleanupExpiredTokenRevocations();

    expect(result).toBe(7);
    expect(mocks.tokenRevocationDeleteMany).toHaveBeenCalledOnce();

    const callArg = mocks.tokenRevocationDeleteMany.mock.calls[0][0];
    expect(callArg.where.expiresAt.lt).toBeInstanceOf(Date);
  });

  it('returns 0 when there are no expired revocations', async () => {
    mocks.tokenRevocationDeleteMany.mockResolvedValue({ count: 0 });

    const result = await cleanupExpiredTokenRevocations();

    expect(result).toBe(0);
  });

  it('returns 0 and logs error when database fails', async () => {
    mocks.tokenRevocationDeleteMany.mockRejectedValue(new Error('cleanup failed'));

    const result = await cleanupExpiredTokenRevocations();
    expect(result).toBe(0);
  });
});

describe('edge cases', () => {
  it('handles very long JTI strings', async () => {
    const longJti = 'jti-' + 'x'.repeat(1000);
    mocks.tokenRevocationFindFirst.mockResolvedValue(null);

    const result = await isTokenRevoked(longJti, 'user-1');

    expect(result).toBe(false);
  });

  it('handles empty strings', async () => {
    mocks.tokenRevocationFindFirst.mockResolvedValue(null);

    const result = await isTokenRevoked('', '');

    expect(result).toBe(false);
  });
});
