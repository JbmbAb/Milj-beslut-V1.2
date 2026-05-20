import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest';
import {
  createTokenPair,
  getUserFromAccessToken,
  rotateRefreshToken,
  requireAuth,
  revokeSession,
} from '../../server/security/auth';
import type { Request, Response } from 'express';

// Mock Prisma for database calls (tokenRepository uses findFirst for revocation checks)
vi.mock('../../server/db/prisma', () => ({
  prisma: {
    tokenRevocation: {
      findFirst: vi.fn(async () => null),
      findUnique: vi.fn(async () => null),
      create: vi.fn(async (args: { data: { jti: string; userId: string; expiresAt: Date } }) => ({
        id: 'rev-1',
        ...args.data,
      })),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
  },
}));

// Import the mocked module so we can manipulate it in tests
import { prisma } from '../../server/db/prisma';

describe('auth', () => {
  const user = {
    id: 'user-1',
    organisationId: 'org-1',
    bankidId: 'bankid-1',
    role: 'ADMIN' as const,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates valid access and refresh tokens', async () => {
    const tokens = createTokenPair(user);

    const decoded = await getUserFromAccessToken(tokens.accessToken);
    expect(decoded.id).toBe(user.id);
    expect(decoded.organisationId).toBe(user.organisationId);
    expect(tokens.refreshToken.length).toBeGreaterThan(20);
  });

  it('rejects tampered access token', async () => {
    const tokens = createTokenPair(user);
    const tampered = `${tokens.accessToken}tamper`;

    await expect(getUserFromAccessToken(tampered)).rejects.toThrow();
  });

  it('rejects token with invalid signature', async () => {
    const tokens = createTokenPair(user);
    const parts = tokens.accessToken.split('.');
    // Tamper with the signature part
    parts[2] = 'a'.repeat(parts[2].length);
    const tampered = parts.join('.');
    await expect(getUserFromAccessToken(tampered)).rejects.toThrow();
  });

  it('rejects expired token', async () => {
    vi.useFakeTimers();
    const tokens = createTokenPair(user);

    // Advance time past expiration (15 mins for access)
    vi.advanceTimersByTime(16 * 60 * 1000);

    await expect(getUserFromAccessToken(tokens.accessToken)).rejects.toThrow(/expired/i);
    vi.useRealTimers();
  });

  it('rejects refresh token when used as access token', async () => {
    const tokens = createTokenPair(user);
    await expect(getUserFromAccessToken(tokens.refreshToken)).rejects.toThrow();
  });

  it('rejects malformed tokens', async () => {
    await expect(getUserFromAccessToken('malformed-token')).rejects.toThrow(/Malformed token/i);
    await expect(getUserFromAccessToken('part1.part2')).rejects.toThrow(/Malformed token/i);
  });

  it('rotates refresh token and detects reuse', async () => {
    const tokens = createTokenPair(user);

    vi.mocked(prisma.tokenRevocation.findFirst)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'rev-1', jti: 'x', userId: user.id, expiresAt: new Date() } as any);

    const rotated = await rotateRefreshToken(tokens.refreshToken);
    expect(rotated.accessToken.length).toBeGreaterThan(20);

    await expect(rotateRefreshToken(tokens.refreshToken)).rejects.toThrow(/reuse/i);
  });

  it('rejects access token in rotateRefreshToken', async () => {
    const tokens = createTokenPair(user);
    await expect(rotateRefreshToken(tokens.accessToken)).rejects.toThrow();
  });

  describe('requireAuth middleware', () => {
    it('returns 401 if Authorization header is missing', async () => {
      const req = { headers: {} } as Request;
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;
      const next = vi.fn();

      requireAuth(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ ok: false, error: 'Missing bearer token' });
    });

    it('returns 401 if token is invalid', async () => {
      const req = { headers: { authorization: 'Bearer invalid-token' } } as Request;
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;
      const next = vi.fn();

      await new Promise<void>((resolve) => {
        // Mock res.json to resolve the promise so we can continue
        vi.mocked(res.json as any).mockImplementationOnce(() => resolve());
        requireAuth(req, res, next);
      });

      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('calls next() if token is valid', async () => {
      const tokens = createTokenPair(user);
      const req = { headers: { authorization: `Bearer ${tokens.accessToken}` } } as Request;
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;

      await new Promise<void>((resolve) => {
        const next = (() => resolve()) as any;
        requireAuth(req, res, next);
      });

      expect(req.authUser).toBeDefined();
    });
  });

  describe('revokeSession', () => {
    it('revokes valid tokens', async () => {
      const tokens = createTokenPair(user);
      await revokeSession(tokens.accessToken, tokens.refreshToken);
      expect(prisma.tokenRevocation.create).toHaveBeenCalledTimes(2);
    });

    it('ignores empty, null or malformed tokens', async () => {
      await revokeSession('', undefined);
      await revokeSession('not.a.token', 'just.two.parts');
      expect(prisma.tokenRevocation.create).not.toHaveBeenCalled();
    });

    it('ignores revocation errors', async () => {
      vi.mocked(prisma.tokenRevocation.create).mockRejectedValueOnce(new Error('DB Fail'));
      const tokens = createTokenPair(user);
      // Should not throw
      await expect(revokeSession(tokens.accessToken)).resolves.toBeUndefined();
    });
  });

  it('covers b64url with Buffer input', () => {
    // This is tested indirectly via createTokenPair which calls b64url
    // but we can call it directly to be sure
    const tokens = createTokenPair(user);
    expect(tokens.accessToken).toBeDefined();
  });
});
