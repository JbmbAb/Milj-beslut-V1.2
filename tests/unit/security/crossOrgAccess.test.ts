import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import crypto from 'node:crypto';

vi.mock('../../../server/modules/sewage/public', () => ({
  getSubmissionOrgAndProjectByKey: vi.fn(),
}));

// 1. Mock EVERYTHING before any imports
vi.mock('../../../server/db/prisma', () => ({
  prisma: {
    submission: {
      findUnique: vi.fn(),
    },
    project: {
      findUnique: vi.fn(),
    },
    projectMember: {
      findUnique: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    tokenRevocation: {
      findUnique: vi.fn(async () => null),
      findFirst: vi.fn(async () => null),
    },
  },
}));

vi.mock('../../../server/security/projectAccess', () => ({
  assertProjectAccess: vi.fn(),
}));

// Bypass CSRF for tests using createApp().
vi.mock('../../../server/security/csrf', () => ({
  csrfProtection: (_req: any, _res: any, next: any) => next(),
}));

// Mock token revocation so auth doesn't fail due to missing DB in unit tests.
vi.mock('../../../server/repositories/tokenRepository', () => ({
  isTokenRevoked: vi.fn(async () => false),
  markRefreshTokenAsUsed: vi.fn(async () => undefined),
  revokeRefreshToken: vi.fn(async () => undefined),
  cleanupExpiredTokenRevocations: vi.fn(async () => 0),
}));

// Bypass rate limiting to avoid prisma.$transaction issues in unit tests.
vi.mock('../../../server/security/rateLimit', () => {
  const noop = (_req: any, _res: any, next: any) => next();
  return {
    rateLimitByUser: vi.fn(() => noop),
    rateLimitByOrg: vi.fn(() => noop),
    rateLimitByIp: vi.fn(() => noop),
    cleanupRateLimits: vi.fn(async () => 0),
    pruneExpiredBuckets: vi.fn(async () => 0),
    _resetBuckets: vi.fn(async () => {}),
  };
});

// We don't mock auth here, we try to use a real token
// but we MUST mock env to return our test secret

const TEST_SECRET = 'test-secret-1234567890-1234567890-1234567890';

vi.mock('../../../server/security/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../server/security/env')>();
  return {
    ...actual,
    getEnv: (key: string) => {
      if (key === 'JWT_ACCESS_SECRET') return TEST_SECRET;
      if (key === 'GEMINI_DB_API_KEY') return 'test-key';
      return process.env[key] || 'mock';
    },
    assertSecurityEnv: vi.fn(),
  };
});

// 2. Now import the app and other things
import { createApp } from '../../../server/createApp';
import { assertProjectAccess } from '../../../server/security/projectAccess';
import { signJwt } from '../../../server/security/auth';
import { getSubmissionOrgAndProjectByKey } from '../../../server/modules/sewage/public';

describe('Security: Cross-Organization Access', () => {
  let app: any;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  const createToken = (userId: string, orgId: string) => {
    return signJwt(
      {
        sub: userId,
        organisationId: orgId,
        bankidId: 'mock-bankid',
        role: 'CONSULTANT',
        type: 'access',
        jti: 'test-jti-' + Math.random(),
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      },
      TEST_SECRET,
    );
  };

  it('should deny access to submission from another organization', async () => {
    (assertProjectAccess as any).mockRejectedValue(new Error('Access denied'));

    const tokenA = createToken('user-a', 'org-a');

    const submissionB = {
      id: 'sub-b',
      submissionKey: 'AVLOPP-B',
      projectId: 'proj-b',
      organisationId: 'org-b',
    };

    vi.mocked(getSubmissionOrgAndProjectByKey).mockResolvedValue({
      projectId: 'proj-b',
      organisationId: 'org-b',
    });

    // Route is at /sewage/application/:key/status (no /api prefix)
    const response = await request(app)
      .get('/sewage/application/AVLOPP-B/status')
      .set('Authorization', `Bearer ${tokenA}`);

    // Access is denied: assertProjectAccess throws → ≥ 400 status
    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it('should allow access to own submission', async () => {
    (assertProjectAccess as any).mockResolvedValue(undefined);

    const tokenA = createToken('user-a', 'org-a');

    const submissionA = {
      id: 'sub-a',
      submissionKey: 'AVLOPP-A',
      projectId: 'proj-a',
      organisationId: 'org-a',
    };

    vi.mocked(getSubmissionOrgAndProjectByKey).mockResolvedValue({
      projectId: 'proj-a',
      organisationId: 'org-a',
    });

    // Route is at /sewage/application/:key/status (no /api prefix)
    const response = await request(app)
      .get('/sewage/application/AVLOPP-A/status')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(response.status, `Cross-org status check failed: ${JSON.stringify(response.body)}`).not.toBe(500);
    expect(response.status, `Cross-org status check failed: ${JSON.stringify(response.body)}`).not.toBe(501);
    expect([200, 404]).toContain(response.status);
  });
});
