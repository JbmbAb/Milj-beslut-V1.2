import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  tokenRevocationCreate: vi.fn(),
  tokenRevocationUpsert: vi.fn(),
  tokenRevocationFindUnique: vi.fn(),
  tokenRevocationDeleteMany: vi.fn(),
}));

vi.mock('../../server/db/prisma', () => ({
  prisma: {
    tokenRevocation: {
      create: mocks.tokenRevocationCreate,
      upsert: mocks.tokenRevocationUpsert,
      findUnique: mocks.tokenRevocationFindUnique,
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

    await expect(
      revokeRefreshToken('user-1', 'jti-dup', new Date()),
    ).rejects.toThrow('unique constraint');
  });
});

describe('revokeAllTokensForUser', () => {
  it('upserts a wildcard revocation record keyed by ALL:<userId>', async () => {
    mocks.tokenRevocationUpsert.mockResolvedValue(undefined);

    const expiresAt = new Date('2027-06-01T00:00:00Z');
    await revokeAllTokensForUser('user-42', expiresAt);

    expect(mocks.tokenRevocationUpsert).toHaveBeenCalledOnce();
    expect(mocks.tokenRevocationUpsert).toHaveBeenCalledWith({
      where: { jti: 'ALL:user-42' },
      create: {
        userId: 'user-42',
        jti: 'ALL:user-42',
        expiresAt,
      },
      update: { expiresAt },
    });
  });

  it('updates expiresAt when the wildcard record already exists', async () => {
    mocks.tokenRevocationUpsert.mockResolvedValue(undefined);

    const firstExpiry = new Date('2027-01-01');
    const secondExpiry = new Date('2028-01-01');

    await revokeAllTokensForUser('user-7', firstExpiry);
    await revokeAllTokensForUser('user-7', secondExpiry);

    expect(mocks.tokenRevocationUpsert).toHaveBeenCalledTimes(2);
    expect(mocks.tokenRevocationUpsert.mock.calls[1][0].update.expiresAt).toEqual(secondExpiry);
  });
});

describe('isTokenRevoked', () => {
  it('returns true when the jti is found in the revocation table', async () => {
    mocks.tokenRevocationFindUnique.mockResolvedValue({ jti: 'jti-bad' });

    const result = await isTokenRevoked('jti-bad');

    expect(result).toBe(true);
    expect(mocks.tokenRevocationFindUnique).toHaveBeenCalledWith({ where: { jti: 'jti-bad' } });
  });

  it('returns false when the jti is not in the revocation table', async () => {
    mocks.tokenRevocationFindUnique.mockResolvedValue(null);

    const result = await isTokenRevoked('jti-ok');

    expect(result).toBe(false);
  });

  it('returns true when the user-level wildcard revocation exists', async () => {
    mocks.tokenRevocationFindUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ jti: 'ALL:user-3' });

    const result = await isTokenRevoked('jti-normal', 'user-3');

    expect(result).toBe(true);
    expect(mocks.tokenRevocationFindUnique).toHaveBeenCalledTimes(2);
    expect(mocks.tokenRevocationFindUnique).toHaveBeenNthCalledWith(2, {
      where: { jti: 'ALL:user-3' },
    });
  });

  it('returns false when neither the jti nor the wildcard is revoked', async () => {
    mocks.tokenRevocationFindUnique.mockResolvedValue(null);

    const result = await isTokenRevoked('jti-clean', 'user-5');

    expect(result).toBe(false);
    expect(mocks.tokenRevocationFindUnique).toHaveBeenCalledTimes(2);
  });

  it('does not check for user wildcard when userId is omitted', async () => {
    mocks.tokenRevocationFindUnique.mockResolvedValue(null);

    await isTokenRevoked('jti-no-user');

    expect(mocks.tokenRevocationFindUnique).toHaveBeenCalledTimes(1);
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
    expect(callArg.where.expiresAt.lt.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('returns 0 when there are no expired revocations', async () => {
    mocks.tokenRevocationDeleteMany.mockResolvedValue({ count: 0 });

    const result = await cleanupExpiredTokenRevocations();

    expect(result).toBe(0);
  });
});
