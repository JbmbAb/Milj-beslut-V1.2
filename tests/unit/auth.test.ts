import { describe, expect, it, beforeEach, vi } from 'vitest';
import { createTokenPair, getUserFromAccessToken, rotateRefreshToken } from '../../server/security/auth';

// Mock Prisma for database calls
vi.mock('../../server/db/prisma', () => ({
  prisma: {
    tokenRevocation: {
      findUnique: vi.fn(async () => null), // Token not revoked initially
      create: vi.fn(async (data) => ({ id: 'rev-1', ...data.data })), // Track revocations
      deleteMany: vi.fn(async () => ({ count: 0 })), // Cleanup
    },
  },
}));

describe('auth', () => {
  const user = {
    id: 'user-1',
    organisationId: 'org-1',
    bankidId: 'bankid-1',
    role: 'ADMIN' as const,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates valid access and refresh tokens', () => {
    const tokens = createTokenPair(user);

    const decoded = getUserFromAccessToken(tokens.accessToken);
    expect(decoded.id).toBe(user.id);
    expect(decoded.organisationId).toBe(user.organisationId);
    expect(tokens.refreshToken.length).toBeGreaterThan(20);
  });

  it('rejects tampered access token', () => {
    const tokens = createTokenPair(user);
    const tampered = `${tokens.accessToken}tamper`;

    expect(() => getUserFromAccessToken(tampered)).toThrow();
  });

  it('rejects refresh token when used as access token', () => {
    const tokens = createTokenPair(user);
    expect(() => getUserFromAccessToken(tokens.refreshToken)).toThrow();
  });

  it('rejects malformed tokens', () => {
    expect(() => getUserFromAccessToken('malformed-token')).toThrow(/Malformed token/);
  });

  it('rotates refresh token and detects reuse', async () => {
    const tokens = createTokenPair(user);

    const rotated = await rotateRefreshToken(tokens.refreshToken);
    expect(rotated.accessToken.length).toBeGreaterThan(20);

    // Mark the token as revoked for reuse detection
    vi.mocked(require('../../server/db/prisma').prisma.tokenRevocation.findUnique).mockResolvedValueOnce({
      id: 'rev-1',
      jti: 'some-jti',
      revokedAt: new Date(),
      expiresAt: new Date(),
    } as any);

    await expect(rotateRefreshToken(tokens.refreshToken)).rejects.toThrow(/reuse/i);
  });
});
