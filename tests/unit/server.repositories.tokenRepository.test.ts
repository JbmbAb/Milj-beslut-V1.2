import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  isTokenRevoked,
  revokeRefreshToken,
  cleanupExpiredTokenRevocations,
} from '../../server/repositories/tokenRepository';
import { prisma } from '../../server/db/prisma';
import { logger } from '../../server/logger';

vi.mock('../../server/db/prisma', () => ({
  prisma: {
    tokenRevocation: {
      findFirst: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

vi.mock('../../server/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
}));

describe('Token Repository (Token Reuse Protection)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('isTokenRevoked returnerar true om token finns i databasen (använd)', async () => {
    vi.mocked(prisma.tokenRevocation.findFirst).mockResolvedValue({ id: '1' } as any);
    const result = await isTokenRevoked('jti-123', 'user-1');
    expect(result).toBe(true);
    expect(prisma.tokenRevocation.findFirst).toHaveBeenCalledWith({
      where: { jti: 'jti-123', userId: 'user-1' },
    });
  });

  it('isTokenRevoked returnerar false om token INTE hittas (giltig)', async () => {
    vi.mocked(prisma.tokenRevocation.findFirst).mockResolvedValue(null);
    const result = await isTokenRevoked('jti-123', 'user-1');
    expect(result).toBe(false);
  });

  it('isTokenRevoked FALLER SÄKERT (returnerar true) om databasen kraschar', async () => {
    vi.mocked(prisma.tokenRevocation.findFirst).mockRejectedValue(new Error('DB Connection Lost'));
    const result = await isTokenRevoked('jti-123', 'user-1');

    expect(result).toBe(true); // Zero trust - blockera åtkomst automatiskt
    expect(logger.error).toHaveBeenCalled();
  });

  it('revokeRefreshToken hanterar P2002 (Unique constraint) smidigt om token redan är revokerad', async () => {
    const error = new Error('Unique constraint failed');
    (error as any).code = 'P2002';
    vi.mocked(prisma.tokenRevocation.create).mockRejectedValue(error);

    await expect(revokeRefreshToken('user-1', 'jti-123', new Date())).resolves.not.toThrow();
    expect(logger.error).not.toHaveBeenCalled(); // Ska ignoreras tyst
  });

  it('cleanupExpiredTokenRevocations städar bort utgångna tokens', async () => {
    vi.mocked(prisma.tokenRevocation.deleteMany).mockResolvedValue({ count: 42 });
    const count = await cleanupExpiredTokenRevocations();

    expect(count).toBe(42);
    expect(prisma.tokenRevocation.deleteMany).toHaveBeenCalledWith({
      where: { expiresAt: { lt: expect.any(Date) } },
    });
  });
});
