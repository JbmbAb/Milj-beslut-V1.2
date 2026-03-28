import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../server/db/prisma', () => ({
  prisma: {
    rateLimitEntry: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

import { prisma } from '../../server/db/prisma';
import { checkRateLimit, resetRateLimitForKey, getActiveRateLimits } from '../../server/security/rateLimitDb';

describe('rateLimitDb', () => {
  const NOW = new Date('2024-05-01T12:00:00.000Z');

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);

    // Default mock implementation for the cleanup task to avoid repeated setup
    vi.mocked(prisma.rateLimitEntry.deleteMany).mockResolvedValue({ count: 0 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('checkRateLimit', () => {
    const maxAttempts = 10;
    const windowMs = 60000; // 1 minute
    const expectedResetAt = new Date(NOW.getTime() + windowMs);

    it('creates a new entry and allows request when not found', async () => {
      vi.mocked(prisma.rateLimitEntry.findUnique).mockResolvedValue(null);

      const key = 'user:björn';
      const result = await checkRateLimit(key, maxAttempts, windowMs);

      expect(prisma.rateLimitEntry.create).toHaveBeenCalledWith({
        data: {
          key,
          count: 1,
          resetAt: expectedResetAt,
        },
      });
      expect(result).toEqual({
        allowed: true,
        remainingAttempts: 9,
        resetAt: expectedResetAt,
      });
    });

    it('resets the entry and allows request when the time window has passed', async () => {
      const key = 'org:gävle_kommun';
      const expiredTime = new Date(NOW.getTime() - 10000); // 10 seconds ago

      vi.mocked(prisma.rateLimitEntry.findUnique).mockResolvedValue({
        id: 'rl-1',
        key,
        count: 10,
        resetAt: expiredTime,
      });

      const result = await checkRateLimit(key, maxAttempts, windowMs);

      expect(prisma.rateLimitEntry.update).toHaveBeenCalledWith({
        where: { key },
        data: {
          count: 1,
          resetAt: expectedResetAt,
        },
      });
      expect(result).toEqual({
        allowed: true,
        remainingAttempts: 9,
        resetAt: expectedResetAt,
      });
    });

    it('blocks request when limit is exceeded within the window', async () => {
      const key = 'ip:127.0.0.1';
      const futureTime = new Date(NOW.getTime() + 30000);

      vi.mocked(prisma.rateLimitEntry.findUnique).mockResolvedValue({
        id: 'rl-2',
        key,
        count: 10,
        resetAt: futureTime,
      });

      const result = await checkRateLimit(key, maxAttempts, windowMs);

      // Update shouldn't be called if exceeded
      expect(prisma.rateLimitEntry.update).not.toHaveBeenCalled();
      expect(result).toEqual({
        allowed: false,
        remainingAttempts: 0,
        resetAt: futureTime,
      });
    });

    it('increments counter and allows request when under limit within window', async () => {
      const key = 'user:östen';
      const futureTime = new Date(NOW.getTime() + 30000);

      vi.mocked(prisma.rateLimitEntry.findUnique).mockResolvedValue({
        id: 'rl-3',
        key,
        count: 3,
        resetAt: futureTime,
      });

      const result = await checkRateLimit(key, maxAttempts, windowMs);

      expect(prisma.rateLimitEntry.update).toHaveBeenCalledWith({
        where: { key },
        data: { count: { increment: 1 } },
      });
      expect(result).toEqual({
        allowed: true,
        remainingAttempts: 6, // 10 - 3 - 1
        resetAt: futureTime,
      });
    });

    it('cleans up expired rate limits before checking', async () => {
      vi.mocked(prisma.rateLimitEntry.findUnique).mockResolvedValue(null);
      await checkRateLimit('test_key', maxAttempts, windowMs);

      expect(prisma.rateLimitEntry.deleteMany).toHaveBeenCalledWith({
        where: { resetAt: { lt: NOW } },
      });
    });

    it('handles database errors gracefully by throwing', async () => {
      vi.mocked(prisma.rateLimitEntry.findUnique).mockRejectedValue(new Error('DB Timeout'));
      await expect(checkRateLimit('crash_key', maxAttempts, windowMs)).rejects.toThrow('DB Timeout');
    });
  });

  describe('resetRateLimitForKey', () => {
    it('deletes the rate limit entry successfully', async () => {
      vi.mocked(prisma.rateLimitEntry.delete).mockResolvedValue({ key: 'admin_override' } as any);
      await resetRateLimitForKey('admin_override');
      expect(prisma.rateLimitEntry.delete).toHaveBeenCalledWith({ where: { key: 'admin_override' } });
    });

    it('ignores errors if the rate limit entry is not found', async () => {
      vi.mocked(prisma.rateLimitEntry.delete).mockRejectedValue(new Error('RecordNotFound'));
      await expect(resetRateLimitForKey('missing_key')).resolves.toBeUndefined();
      expect(prisma.rateLimitEntry.delete).toHaveBeenCalledOnce();
    });
  });

  describe('getActiveRateLimits', () => {
    it('returns formatted list of currently active rate limits', async () => {
      const mockEntries = [
        { id: 'rl-4', key: 'user:1', count: 5, resetAt: new Date(NOW.getTime() + 1000) },
        { id: 'rl-5', key: 'org:2', count: 99, resetAt: new Date(NOW.getTime() + 5000) },
      ];

      vi.mocked(prisma.rateLimitEntry.findMany).mockResolvedValue(mockEntries);

      const results = await getActiveRateLimits();
      expect(prisma.rateLimitEntry.findMany).toHaveBeenCalledWith({
        where: { resetAt: { gt: NOW } },
      });
      expect(results).toEqual(mockEntries);
    });
  });
});
