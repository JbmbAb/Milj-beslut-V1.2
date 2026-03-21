import { describe, expect, it, vi } from 'vitest';
import { rateLimitByOrg, rateLimitByUser, pruneExpiredBuckets } from '../../server/security/rateLimit';

function createRes() {
  return {
    headers: {} as Record<string, string>,
    statusCode: 200,
    setHeader(key: string, value: string) {
      this.headers[key] = value;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json: vi.fn(),
  };
}

describe('rateLimit', () => {
  it('limits non-admin user requests and sets rate headers', () => {
    const middleware = rateLimitByUser(1, 60_000);
    const req = {
      authUser: { id: `user-${Date.now()}`, role: 'CONSULTANT' },
      ip: '127.0.0.1',
      path: `/test-user-${Date.now()}`,
    } as any;

    const res1 = createRes();
    const next1 = vi.fn();
    middleware(req, res1 as any, next1);
    expect(next1).toHaveBeenCalledTimes(1);
    expect(res1.headers['X-RateLimit-Remaining']).toBeDefined();

    const res2 = createRes();
    const next2 = vi.fn();
    middleware(req, res2 as any, next2);
    expect(next2).not.toHaveBeenCalled();
    expect(res2.statusCode).toBe(429);
  });

  it('bypasses user limit for admin role', () => {
    const middleware = rateLimitByUser(1, 60_000);
    const req = {
      authUser: { id: 'admin-1', role: 'ADMIN' },
      ip: '127.0.0.1',
      path: '/admin-bypass',
    } as any;

    const res = createRes();
    const next = vi.fn();
    middleware(req, res as any, next);
    middleware(req, res as any, next);

    expect(next).toHaveBeenCalledTimes(2);
  });

  it('limits organization quota for non-admin users', () => {
    const middleware = rateLimitByOrg(1, 60_000);
    const req = {
      authUser: {
        id: `user-org-${Date.now()}`,
        role: 'CONSULTANT',
        organisationId: `org-${Date.now()}`,
      },
      path: `/test-org-${Date.now()}`,
    } as any;

    const res1 = createRes();
    const next1 = vi.fn();
    middleware(req, res1 as any, next1);
    expect(next1).toHaveBeenCalledTimes(1);

    const res2 = createRes();
    const next2 = vi.fn();
    middleware(req, res2 as any, next2);

    expect(next2).not.toHaveBeenCalled();
    expect(res2.statusCode).toBe(429);
  });
});

describe('pruneExpiredBuckets', () => {
  it('is callable and does not throw', () => {
    // Create a throttled bucket that will expire immediately (1 ms window)
    const middleware = rateLimitByUser(1, 1);
    const req = {
      authUser: { id: `prune-user-${Date.now()}`, role: 'CONSULTANT' },
      ip: '127.0.0.1',
      path: `/prune-path-${Date.now()}`,
    } as any;
    const res = createRes();
    middleware(req, res as any, vi.fn());

    // Wait for window to expire, then prune
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(() => pruneExpiredBuckets()).not.toThrow();
        resolve();
      }, 5);
    });
  });
});

