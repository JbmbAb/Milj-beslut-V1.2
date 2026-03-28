import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTokenPair } from '../../server/security/auth';

const mocks = vi.hoisted(() => ({
  cancelBankIdAuth: vi.fn(),
  collectBankIdAuth: vi.fn(),
  ensureAdminConsoleUser: vi.fn(),
  generateAnimatedQrPayload: vi.fn(),
  initiateBankIdAuth: vi.fn(),
  refreshSession: vi.fn(),
}));

vi.mock('../../server/repositories/tokenRepository', () => ({
  isTokenRevoked: vi.fn(async () => false),
  markRefreshTokenAsUsed: vi.fn(async () => undefined),
  revokeRefreshToken: vi.fn(async () => undefined),
  cleanupExpiredTokenRevocations: vi.fn(async () => 0),
}));

vi.mock('../../server/services/bankIdService', () => ({
  initiateBankIdAuth: mocks.initiateBankIdAuth,
  generateAnimatedQrPayload: mocks.generateAnimatedQrPayload,
  collectBankIdAuth: mocks.collectBankIdAuth,
  cancelBankIdAuth: mocks.cancelBankIdAuth,
  refreshSession: mocks.refreshSession,
}));

vi.mock('../../server/repositories/userRepository', () => ({
  ensureAdminConsoleUser: mocks.ensureAdminConsoleUser,
  findAuthUserByBankId: vi.fn(async () => null),
}));

import authRoutes from '../../server/routes/auth.routes';

const app = express();
app.use(express.json());
app.use(authRoutes);

function authHeader() {
  return `Bearer ${
    createTokenPair({
      id: 'admin-1',
      organisationId: 'org-1',
      bankidId: 'admin:one',
      role: 'ADMIN',
    }).accessToken
  }`;
}

describe('auth.routes', () => {
  const originalUsername = process.env.ADMIN_CONSOLE_USERNAME;
  const originalPassword = process.env.ADMIN_CONSOLE_PASSWORD;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_CONSOLE_USERNAME = 'admin';
    process.env.ADMIN_CONSOLE_PASSWORD = 'secret-password';

    mocks.initiateBankIdAuth.mockResolvedValue({
      orderRef: 'order-1',
      autoStartToken: 'auto-token',
      qrStartToken: 'qr-token',
      qrStartSecret: 'qr-secret',
    });
    mocks.generateAnimatedQrPayload.mockReturnValue('bankid.qr-token.0.mock');
    mocks.collectBankIdAuth.mockResolvedValue({
      status: 'pending',
      hintCode: 'outstandingTransaction',
    });
    mocks.cancelBankIdAuth.mockResolvedValue({ cancelled: true });
    mocks.refreshSession.mockResolvedValue({
      accessToken: 'next-access',
      refreshToken: 'next-refresh',
    });
    mocks.ensureAdminConsoleUser.mockResolvedValue({
      id: 'admin-1',
      organisationId: 'org-1',
      role: 'ADMIN',
      bankidId: 'admin:admin',
    });
  });

  afterEach(() => {
    if (originalUsername === undefined) delete process.env.ADMIN_CONSOLE_USERNAME;
    else process.env.ADMIN_CONSOLE_USERNAME = originalUsername;
    if (originalPassword === undefined) delete process.env.ADMIN_CONSOLE_PASSWORD;
    else process.env.ADMIN_CONSOLE_PASSWORD = originalPassword;
  });

  it('starts a BankID order and returns qr payload metadata', async () => {
    const res = await request(app).post('/api/auth/bankid/init').send({ endUserIp: '127.0.0.1' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      orderRef: 'order-1',
      qrPayload: 'bankid.qr-token.0.mock',
    });
    expect(mocks.initiateBankIdAuth).toHaveBeenCalledWith('127.0.0.1');
    expect(mocks.generateAnimatedQrPayload).toHaveBeenCalled();
  });

  it('returns safe errors for collect failures and 401 for refresh failures', async () => {
    mocks.collectBankIdAuth.mockRejectedValueOnce(new Error('collect failed'));
    mocks.refreshSession.mockRejectedValueOnce(new Error('refresh failed'));

    const collect = await request(app).post('/api/auth/bankid/collect').send({ orderRef: 'order-1' });

    expect(collect.status).toBe(400);
    expect(String(collect.body?.error || '')).toBe('An error occurred processing your request');

    const refresh = await request(app).post('/api/auth/refresh').send({ refreshToken: 'expired-token' });

    expect(refresh.status).toBe(401);
    expect(String(refresh.body?.error || '')).toBe('An error occurred processing your request');
  });

  it('cancels BankID flows and logs users out with bearer auth', async () => {
    const cancel = await request(app).post('/api/auth/bankid/cancel').send({ orderRef: 'order-1' });

    expect(cancel.status).toBe(200);
    expect(cancel.body).toEqual({ ok: true, cancelled: true });

    const logout = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', authHeader())
      .send({ refreshToken: 'refresh-token' });

    expect(logout.status).toBe(200);
    expect(logout.body).toEqual({ ok: true, message: 'Logged out successfully' });
  });

  it('guards admin console login configuration and credentials', async () => {
    delete process.env.ADMIN_CONSOLE_PASSWORD;

    const missingConfig = await request(app)
      .post('/api/admin/auth/login')
      .send({ username: 'admin', password: 'secret-password' });

    expect(missingConfig.status).toBe(503);

    process.env.ADMIN_CONSOLE_PASSWORD = 'secret-password';
    const invalid = await request(app)
      .post('/api/admin/auth/login')
      .send({ username: 'admin', password: 'wrong' });

    expect(invalid.status).toBe(401);

    const valid = await request(app)
      .post('/api/admin/auth/login')
      .send({ username: 'admin', password: 'secret-password' });

    expect(valid.status).toBe(200);
    expect(valid.body).toMatchObject({
      ok: true,
      user: {
        id: 'admin-1',
        role: 'ADMIN',
        organisationId: 'org-1',
      },
    });
    expect(typeof valid.body?.accessToken).toBe('string');
    expect(typeof valid.body?.refreshToken).toBe('string');
  });
});
