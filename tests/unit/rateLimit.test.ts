import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { rateLimitByUser, rateLimitByOrg, _resetBuckets } from '../../server/security/rateLimit';

describe('rateLimit', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let nextFunction: NextFunction;

  beforeEach(() => {
    _resetBuckets();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T12:00:00Z'));

    mockReq = {
      path: '/api/test',
      ip: '192.168.1.1',
      authUser: undefined,
    };

    mockRes = {
      setHeader: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };

    nextFunction = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('rateLimitByUser', () => {
    it('returns expected result on success and sets remaining headers', () => {
      const middleware = rateLimitByUser(2, 1000);

      middleware(mockReq as Request, mockRes as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalledOnce();
      expect(mockRes.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', '1');
      expect(mockRes.setHeader).toHaveBeenCalledWith('X-RateLimit-Reset', expect.any(String));
    });

    it('throws error when limit exceeded (429)', () => {
      const middleware = rateLimitByUser(1, 1000);

      middleware(mockReq as Request, mockRes as Response, nextFunction); // 1st allowed
      middleware(mockReq as Request, mockRes as Response, nextFunction); // 2nd blocked

      expect(nextFunction).toHaveBeenCalledOnce();
      expect(mockRes.status).toHaveBeenCalledWith(429);
      expect(mockRes.json).toHaveBeenCalledWith({ ok: false, error: 'Rate limit exceeded' });
    });

    it('bypasses rate limit completely for ADMIN users', () => {
      mockReq.authUser = { id: 'admin1', role: 'ADMIN', organisationId: 'org1' } as any;
      const middleware = rateLimitByUser(1, 1000);

      middleware(mockReq as Request, mockRes as Response, nextFunction);
      middleware(mockReq as Request, mockRes as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalledTimes(2);
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('handles edge case: missing IP falls back to anonymous', () => {
      const req = { ...(mockReq as any), ip: undefined } as Request;
      const middleware = rateLimitByUser(1, 1000);

      middleware(req, mockRes as Response, nextFunction);
      expect(nextFunction).toHaveBeenCalledOnce();
    });

    it('resets the bucket allowance after windowMs passes', () => {
      const middleware = rateLimitByUser(1, 1000);

      middleware(mockReq as Request, mockRes as Response, nextFunction);
      expect(nextFunction).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(1001); // Fast-forward past the windowMs

      middleware(mockReq as Request, mockRes as Response, nextFunction);
      expect(nextFunction).toHaveBeenCalledTimes(2); // Allowed again
    });
  });

  describe('rateLimitByOrg', () => {
    it('returns expected result on success for organization', () => {
      mockReq.authUser = { id: 'user1', role: 'CONSULTANT', organisationId: 'org1' } as any;
      const middleware = rateLimitByOrg(2, 1000);

      middleware(mockReq as Request, mockRes as Response, nextFunction);
      expect(nextFunction).toHaveBeenCalledOnce();
    });

    it('throws error when org limit exceeded (429)', () => {
      mockReq.authUser = { id: 'user1', role: 'CONSULTANT', organisationId: 'org1' } as any;
      const middleware = rateLimitByOrg(1, 1000);

      middleware(mockReq as Request, mockRes as Response, nextFunction);
      middleware(mockReq as Request, mockRes as Response, nextFunction);

      expect(mockRes.status).toHaveBeenCalledWith(429);
      expect(mockRes.json).toHaveBeenCalledWith({ ok: false, error: 'Organisation quota exceeded' });
    });

    it('handles edge case: missing organization falls back to "none"', () => {
      const middleware = rateLimitByOrg(1, 1000); // No authUser
      middleware(mockReq as Request, mockRes as Response, nextFunction);
      expect(nextFunction).toHaveBeenCalledOnce();
    });
  });
});
