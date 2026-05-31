import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Request, Response } from 'express';

vi.mock('../../server/db/prisma', () => ({
  prisma: {
    $transaction: vi.fn((cb) => cb(prismaMock)),
    rateLimitEntry: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

import { prisma } from '../../server/db/prisma';
import {
  rateLimitByUser,
  rateLimitByOrg,
  _resetBuckets,
  pruneExpiredBuckets,
} from '../../server/security/rateLimit';

const prismaMock = prisma.rateLimitEntry as any;

describe('server/security/rateLimit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.$transaction as any).mockImplementation((cb: any) => cb(prisma));
    delete process.env.DISABLE_DB_RATE_LIMIT;
  });

  describe('rateLimitByUser', () => {
    it('allows requests within limit', async () => {
      const middleware = rateLimitByUser(5, 1000);
      const req = {
        authUser: { id: 'user1', role: 'CONSULTANT', organisationId: 'org1', bankidId: 'bid1' },
        ip: '127.0.0.1',
        path: '/api/test',
      } as unknown as Request;
      const res = {
        setHeader: vi.fn(),
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as unknown as Response;
      const next = vi.fn();

      prismaMock.findUnique.mockResolvedValue({ count: 1, resetAt: new Date(Date.now() + 1000) });
      prismaMock.update.mockResolvedValue({ count: 2 });

      for (let i = 0; i < 5; i++) {
        await middleware(req, res, next);
      }

      expect(next).toHaveBeenCalledTimes(5);
      expect(res.status).not.toHaveBeenCalled();
    });

    it('blocks requests exceeding limit', async () => {
      const middleware = rateLimitByUser(2, 1000);
      const req = {
        authUser: { id: 'user1', role: 'CONSULTANT', organisationId: 'org1', bankidId: 'bid1' },
        ip: '127.0.0.1',
        path: '/api/test',
      } as unknown as Request;
      const res = {
        setHeader: vi.fn(),
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as unknown as Response;
      const next = vi.fn();

      // 1st call
      prismaMock.findUnique.mockResolvedValueOnce(null);
      prismaMock.upsert.mockResolvedValueOnce({ count: 1, resetAt: new Date(Date.now() + 1000) });
      await middleware(req, res, next);

      // 2nd call
      prismaMock.findUnique.mockResolvedValueOnce({ count: 1, resetAt: new Date(Date.now() + 1000) });
      prismaMock.update.mockResolvedValueOnce({ count: 2 });
      await middleware(req, res, next);

      // 3rd call - exceeds
      prismaMock.findUnique.mockResolvedValueOnce({ count: 2, resetAt: new Date(Date.now() + 1000) });
      prismaMock.update.mockResolvedValueOnce({ count: 3 });
      await middleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(2);
      expect(res.status).toHaveBeenCalledWith(429);
      expect(res.json).toHaveBeenCalledWith({ ok: false, error: 'Rate limit exceeded' });
    });

    it('bypasses rate limit for ADMIN users', async () => {
      const middleware = rateLimitByUser(1, 1000);
      const req = {
        authUser: { id: 'admin1', role: 'ADMIN', organisationId: 'org1', bankidId: 'bid1' },
        ip: '127.0.0.1',
        path: '/api/test',
      } as unknown as Request;
      const res = {
        setHeader: vi.fn(),
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as unknown as Response;
      const next = vi.fn();

      // Admin should bypass rate limiting regardless of count
      for (let i = 0; i < 10; i++) {
        await middleware(req, res, next);
      }

      expect(next).toHaveBeenCalledTimes(10);
      expect(res.status).not.toHaveBeenCalled();
      expect(prismaMock.findUnique).not.toHaveBeenCalled();
    });

    it('uses IP when user is not authenticated', async () => {
      const middleware = rateLimitByUser(1, 1000);
      const req = {
        authUser: undefined,
        ip: '192.168.1.1',
        path: '/api/test',
      } as unknown as Request;
      const res = {
        setHeader: vi.fn(),
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as unknown as Response;
      const next = vi.fn();

      prismaMock.findUnique.mockResolvedValueOnce(null);
      prismaMock.upsert.mockResolvedValueOnce({ count: 1, resetAt: new Date(Date.now() + 1000) });
      await middleware(req, res, next);

      prismaMock.findUnique.mockResolvedValueOnce({ count: 1, resetAt: new Date(Date.now() + 1000) });
      prismaMock.update.mockResolvedValueOnce({ count: 2 });
      await middleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).toHaveBeenCalledWith(429);
    });

    it('sets correct rate limit headers', async () => {
      const middleware = rateLimitByUser(3, 1000);
      const req = {
        authUser: { id: 'user1', role: 'CONSULTANT', organisationId: 'org1', bankidId: 'bid1' },
        ip: '127.0.0.1',
        path: '/api/test',
      } as unknown as Request;
      const res = {
        setHeader: vi.fn(),
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as unknown as Response;
      const next = vi.fn();

      prismaMock.findUnique.mockResolvedValueOnce({ count: 1, resetAt: new Date(Date.now() + 1000) });
      prismaMock.update.mockResolvedValueOnce({ count: 2 });

      await middleware(req, res, next);

      expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', '1');
      expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Reset', expect.any(String));
    });

    it('fails open when the rate limit database errors', async () => {
      const middleware = rateLimitByUser(3, 1000);
      const req = {
        authUser: { id: 'user1', role: 'CONSULTANT', organisationId: 'org1', bankidId: 'bid1' },
        ip: '127.0.0.1',
        path: '/api/test',
      } as unknown as Request;
      const res = {
        setHeader: vi.fn(),
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as unknown as Response;
      const next = vi.fn();

      (prisma.$transaction as any).mockRejectedValueOnce(new Error('db down'));

      await middleware(req, res, next);

      expect(next).toHaveBeenCalledOnce();
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  describe('rateLimitByOrg', () => {
    it('allows requests within org quota', async () => {
      const middleware = rateLimitByOrg(5, 1000);
      const req = {
        authUser: { id: 'user1', role: 'CONSULTANT', organisationId: 'org1', bankidId: 'bid1' },
        ip: '127.0.0.1',
        path: '/api/test',
      } as unknown as Request;
      const res = {
        setHeader: vi.fn(),
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as unknown as Response;
      const next = vi.fn();

      prismaMock.findUnique.mockResolvedValue({ count: 1, resetAt: new Date(Date.now() + 1000) });
      prismaMock.update.mockResolvedValue({ count: 2 });

      for (let i = 0; i < 5; i++) {
        await middleware(req, res, next);
      }

      expect(next).toHaveBeenCalledTimes(5);
      expect(res.status).not.toHaveBeenCalled();
    });

    it('blocks when org quota exceeded', async () => {
      const middleware = rateLimitByOrg(2, 1000);
      const req = {
        authUser: { id: 'user1', role: 'CONSULTANT', organisationId: 'org1', bankidId: 'bid1' },
        ip: '127.0.0.1',
        path: '/api/test',
      } as unknown as Request;
      const res = {
        setHeader: vi.fn(),
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as unknown as Response;
      const next = vi.fn();

      prismaMock.findUnique.mockResolvedValueOnce({ count: 2, resetAt: new Date(Date.now() + 1000) });
      prismaMock.update.mockResolvedValueOnce({ count: 3 });

      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(429);
      expect(res.json).toHaveBeenCalledWith({ ok: false, error: 'Organisation quota exceeded' });
    });

    it('bypasses organisation rate limit for ADMIN users', async () => {
      const middleware = rateLimitByOrg(1, 1000);
      const req = {
        authUser: { id: 'admin1', role: 'ADMIN', organisationId: 'org1', bankidId: 'bid1' },
        ip: '127.0.0.1',
        path: '/api/test',
      } as unknown as Request;
      const res = {
        setHeader: vi.fn(),
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as unknown as Response;
      const next = vi.fn();

      await middleware(req, res, next);

      expect(next).toHaveBeenCalledOnce();
      expect(prismaMock.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('pruneExpiredBuckets', () => {
    it('removes expired entries', async () => {
      prismaMock.deleteMany.mockResolvedValue({ count: 5 });
      const count = await pruneExpiredBuckets();
      expect(count).toBe(5);
      expect(prismaMock.deleteMany).toHaveBeenCalled();
    });

    it('returns 0 when db rate limit is disabled', async () => {
      process.env.DISABLE_DB_RATE_LIMIT = 'true';

      const count = await pruneExpiredBuckets();

      expect(count).toBe(0);
      expect(prismaMock.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('_resetBuckets', () => {
    it('clears buckets when enabled', async () => {
      prismaMock.deleteMany.mockResolvedValue({ count: 2 });

      await _resetBuckets();

      expect(prismaMock.deleteMany).toHaveBeenCalledWith({});
    });

    it('skips clearing when db rate limit is disabled', async () => {
      process.env.DISABLE_DB_RATE_LIMIT = 'yes';

      await _resetBuckets();

      expect(prismaMock.deleteMany).not.toHaveBeenCalled();
    });
  });
});
