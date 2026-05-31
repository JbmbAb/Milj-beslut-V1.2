import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const prismaRateLimitMock = vi.hoisted(() => ({
  findUnique: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  upsert: vi.fn(),
  deleteMany: vi.fn(),
  delete: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock('../../server/db/prisma', () => ({
  prisma: {
    rateLimitEntry: prismaRateLimitMock,
  },
}));

import { checkRateLimit, getActiveRateLimits, resetRateLimitForKey } from '../../server/security/rateLimitDb';

const now = new Date('2024-06-01T12:00:00Z');
const futureReset = new Date('2024-06-01T12:01:00Z');

describe('checkRateLimit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates a new entry on first request and allows it', async () => {
    prismaRateLimitMock.findUnique.mockResolvedValue(null);
    prismaRateLimitMock.upsert.mockResolvedValue({ resetAt: futureReset });

    const result = await checkRateLimit('user:u1', 10, 60_000);

    expect(result.allowed).toBe(true);
    expect(result.remainingAttempts).toBe(9);
    expect(prismaRateLimitMock.upsert).toHaveBeenCalled();
  });

  it('increments count when under limit', async () => {
    prismaRateLimitMock.findUnique.mockResolvedValue({
      key: 'user:u1',
      count: 3,
      resetAt: futureReset,
    });
    prismaRateLimitMock.update.mockResolvedValue({ key: 'user:u1', count: 4, resetAt: futureReset });

    const result = await checkRateLimit('user:u1', 10, 60_000);

    expect(result.allowed).toBe(true);
    expect(result.remainingAttempts).toBe(6);
    expect(prismaRateLimitMock.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: 'user:u1' }, data: { count: { increment: 1 } } }),
    );
  });

  it('blocks requests when limit is reached', async () => {
    prismaRateLimitMock.findUnique.mockResolvedValue({
      key: 'user:u1',
      count: 10,
      resetAt: futureReset,
    });

    const result = await checkRateLimit('user:u1', 10, 60_000);

    expect(result.allowed).toBe(false);
    expect(result.remainingAttempts).toBe(0);
    expect(prismaRateLimitMock.update).not.toHaveBeenCalled();
  });

  it('resets counter when window has expired', async () => {
    const pastReset = new Date('2024-06-01T11:59:00Z'); // before `now`
    prismaRateLimitMock.findUnique.mockResolvedValue({
      key: 'user:u1',
      count: 10,
      resetAt: pastReset,
    });
    prismaRateLimitMock.upsert.mockResolvedValue({ resetAt: futureReset });

    const result = await checkRateLimit('user:u1', 10, 60_000);

    expect(result.allowed).toBe(true);
    expect(prismaRateLimitMock.upsert).toHaveBeenCalled();
  });

  it('does not perform cleanup on every check', async () => {
    prismaRateLimitMock.findUnique.mockResolvedValue(null);
    prismaRateLimitMock.upsert.mockResolvedValue({ resetAt: futureReset });

    await checkRateLimit('user:u1', 5, 60_000);

    expect(prismaRateLimitMock.deleteMany).not.toHaveBeenCalled();
  });
});

describe('resetRateLimitForKey', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deletes the rate limit entry for the given key', async () => {
    prismaRateLimitMock.delete.mockResolvedValue({});
    await resetRateLimitForKey('user:u1');
    expect(prismaRateLimitMock.delete).toHaveBeenCalledWith({ where: { key: 'user:u1' } });
  });

  it('silently ignores errors when entry does not exist', async () => {
    prismaRateLimitMock.delete.mockRejectedValue(new Error('not found'));
    await expect(resetRateLimitForKey('user:u1')).resolves.toBeUndefined();
  });
});

describe('getActiveRateLimits', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns active rate limit entries', async () => {
    prismaRateLimitMock.findMany.mockResolvedValue([
      { key: 'user:u1', count: 3, resetAt: futureReset },
      { key: 'org:o1', count: 15, resetAt: futureReset },
    ]);

    const result = await getActiveRateLimits();

    expect(result).toHaveLength(2);
    expect(result[0].key).toBe('user:u1');
    expect(result[1].key).toBe('org:o1');
    expect(prismaRateLimitMock.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { resetAt: { gt: now } } }),
    );
  });

  it('returns empty array when no active limits exist', async () => {
    prismaRateLimitMock.findMany.mockResolvedValue([]);
    const result = await getActiveRateLimits();
    expect(result).toEqual([]);
  });
});
