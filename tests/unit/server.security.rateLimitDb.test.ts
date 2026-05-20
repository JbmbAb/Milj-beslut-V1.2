import { describe, it, expect, beforeEach, vi } from 'vitest';
import { checkRateLimit, resetRateLimitForKey, getActiveRateLimits } from '../../server/security/rateLimitDb';
import { prisma } from '../../server/db/prisma';

vi.mock('../../server/db/prisma', () => ({
  prisma: {
    rateLimitEntry: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
      deleteMany: vi.fn(),
      delete: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

describe('server/security/rateLimitDb', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('checkRateLimit', () => {
    it('allows request when below limit', async () => {
      const key = 'user:user123';
      const now = new Date();

      vi.mocked(prisma.rateLimitEntry.deleteMany).mockResolvedValue({ count: 0 });
      vi.mocked(prisma.rateLimitEntry.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.rateLimitEntry.upsert).mockResolvedValue({
        id: '1',
        key,
        count: 1,
        resetAt: new Date(now.getTime() + 1000),
        createdAt: now,
      } as any);

      const result = await checkRateLimit(key, 5, 1000);

      expect(result.allowed).toBe(true);
      expect(result.remainingAttempts).toBe(4);
      expect(result.resetAt).toBeDefined();
    });

    it('blocks request when at limit', async () => {
      const key = 'user:user123';
      const now = new Date();
      const resetAt = new Date(now.getTime() + 5000);

      vi.mocked(prisma.rateLimitEntry.deleteMany).mockResolvedValue({ count: 0 });
      vi.mocked(prisma.rateLimitEntry.findUnique).mockResolvedValue({
        id: '1',
        key,
        count: 5,
        resetAt,
        createdAt: now,
      } as any);

      const result = await checkRateLimit(key, 5, 1000);

      expect(result.allowed).toBe(false);
      expect(result.remainingAttempts).toBe(0);
      expect(result.resetAt).toEqual(resetAt);
    });

    it('increments counter for subsequent requests', async () => {
      const key = 'user:user123';
      const now = new Date();
      const resetAt = new Date(now.getTime() + 5000);

      vi.mocked(prisma.rateLimitEntry.deleteMany).mockResolvedValue({ count: 0 });
      vi.mocked(prisma.rateLimitEntry.findUnique).mockResolvedValue({
        id: '1',
        key,
        count: 2,
        resetAt,
        createdAt: now,
      } as any);
      vi.mocked(prisma.rateLimitEntry.update).mockResolvedValue({
        id: '1',
        key,
        count: 3,
        resetAt,
        createdAt: now,
      } as any);

      const result = await checkRateLimit(key, 5, 1000);

      expect(result.allowed).toBe(true);
      expect(result.remainingAttempts).toBe(2);
      expect(prisma.rateLimitEntry.update).toHaveBeenCalled();
    });

    it('resets entry when window has passed', async () => {
      const key = 'user:user123';
      const now = new Date();
      const expiredResetAt = new Date(now.getTime() - 1000);

      vi.mocked(prisma.rateLimitEntry.deleteMany).mockResolvedValue({ count: 0 });
      vi.mocked(prisma.rateLimitEntry.findUnique).mockResolvedValue({
        id: '1',
        key,
        count: 5,
        resetAt: expiredResetAt,
        createdAt: now,
      } as any);
      vi.mocked(prisma.rateLimitEntry.update).mockResolvedValue({} as any);

      const result = await checkRateLimit(key, 5, 1000);

      expect(result.allowed).toBe(true);
      expect(result.remainingAttempts).toBe(4);
      expect(prisma.rateLimitEntry.update).toHaveBeenCalled();
    });

    it('handles database errors gracefully', async () => {
      vi.mocked(prisma.rateLimitEntry.findUnique).mockRejectedValue(new Error('DB Error'));

      await expect(checkRateLimit('key', 5, 1000)).rejects.toThrow('DB Error');
    });
  });

  describe('resetRateLimitForKey', () => {
    it('deletes entry for specified key', async () => {
      vi.mocked(prisma.rateLimitEntry.delete).mockResolvedValue({} as any);

      await resetRateLimitForKey('user:123');

      expect(prisma.rateLimitEntry.delete).toHaveBeenCalledWith({
        where: { key: 'user:123' },
      });
    });

    it('handles missing keys during reset', async () => {
      vi.mocked(prisma.rateLimitEntry.delete).mockRejectedValue(new Error('Not found'));

      await expect(resetRateLimitForKey('nonexistent')).resolves.not.toThrow();
    });
  });

  describe('getActiveRateLimits', () => {
    it('returns all non-expired rate limits', async () => {
      const now = new Date();
      const futureResetAt = new Date(now.getTime() + 10000);
      const mockEntries = [
        { id: '1', key: 'user:user1', count: 3, resetAt: futureResetAt, createdAt: now },
        { id: '2', key: 'org:org1', count: 5, resetAt: futureResetAt, createdAt: now },
      ];

      vi.mocked(prisma.rateLimitEntry.findMany).mockResolvedValue(mockEntries as any);

      const result = await getActiveRateLimits();

      expect(result).toHaveLength(2);
      expect(result[0].key).toBe('user:user1');
      expect(prisma.rateLimitEntry.findMany).toHaveBeenCalledWith({
        where: { resetAt: { gt: expect.any(Date) } },
      });
    });
  });
});
