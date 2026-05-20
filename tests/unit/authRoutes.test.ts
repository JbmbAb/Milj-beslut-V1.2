import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTokenPair } from '../../server/security/auth';

const mocks = vi.hoisted(() => ({
  cancelBankIdAuth: vi.fn(),
  collectBankIdAuth: vi.fn(),
  completeMockBankIdOrder: vi.fn(),
  ensureAdminConsoleUser: vi.fn(),
  failMockBankIdOrder: vi.fn(),
  getBankIdMode: vi.fn(),
  getMockBankIdOrder: vi.fn(),
  initiateBankIdAuth: vi.fn(),
  normalizeBankIdPersonalNumber: vi.fn(),
  refreshSession: vi.fn(),
}));

vi.mock('../../src/platform/master', () => ({
  platform: {
    auth: {
      initiateBankId: mocks.initiateBankIdAuth,
      collectBankId: mocks.collectBankIdAuth,
      cancelBankId: mocks.cancelBankIdAuth,
    },
  },
}));

vi.mock('../../server/repositories/tokenRepository', () => ({
  isTokenRevoked: vi.fn(async () => false),
  markRefreshTokenAsUsed: vi.fn(async () => undefined),
  revokeRefreshToken: vi.fn(async () => undefined),
  cleanupExpiredTokenRevocations: vi.fn(async () => 0),
}));

vi.mock('../../server/services/bankIdService', () => ({
  getBankIdMode: mocks.getBankIdMode,
  getMockBankIdOrder: mocks.getMockBankIdOrder,
  completeMockBankIdOrder: mocks.completeMockBankIdOrder,
  failMockBankIdOrder: mocks.failMockBankIdOrder,
  normalizeBankIdPersonalNumber: mocks.normalizeBankIdPersonalNumber,
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
      launchMode: 'mock',
      launchUrl: '/api/auth/bankid/mock/launch/order-1',
    });
    mocks.normalizeBankIdPersonalNumber.mockImplementation((value: unknown) => {
      const digits = String(value ?? '').replace(/\D/g, '');
      return digits || undefined;
    });
    mocks.collectBankIdAuth.mockResolvedValue({
      status: 'pending',
      hintCode: 'outstandingTransaction',
    });
    mocks.cancelBankIdAuth.mockResolvedValue(true);
    mocks.getBankIdMode.mockReturnValue('mock');
    mocks.getMockBankIdOrder.mockReturnValue({
      orderRef: 'order-1',
      status: 'pending',
      hintCode: 'outstandingTransaction',
      createdAt: '2026-03-29T10:00:00.000Z',
      launchUrl: '/api/auth/bankid/mock/launch/order-1',
      completionData: null,
    });
    mocks.completeMockBankIdOrder.mockReturnValue({
      orderRef: 'order-1',
      status: 'complete',
      hintCode: null,
      createdAt: '2026-03-29T10:00:00.000Z',
      launchUrl: '/api/auth/bankid/mock/launch/order-1',
      completionData: {
        user: {
          personalNumber: 'mock-bankid-testuser-1',
          givenName: 'Mock',
          surname: 'User',
          name: 'Mock User',
        },
      },
    });
    mocks.failMockBankIdOrder.mockReturnValue({
      orderRef: 'order-1',
      status: 'failed',
      hintCode: 'userCancel',
      createdAt: '2026-03-29T10:00:00.000Z',
      launchUrl: '/api/auth/bankid/mock/launch/order-1',
      completionData: null,
    });
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

  it('starts a BankID order and returns launch metadata', async () => {
    const res = await request(app).post('/api/auth/bankid/init').send({ endUserIp: '127.0.0.1' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      orderRef: 'order-1',
      launchMode: 'mock',
      launchUrl: '/api/auth/bankid/mock/launch/order-1',
    });
    expect(mocks.initiateBankIdAuth).toHaveBeenCalledWith('127.0.0.1', {
      personalNumber: undefined,
    });
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

  it('exposes mock BankID order control routes in mock mode', async () => {
    const status = await request(app).get('/api/auth/bankid/mock/orders/order-1');
    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({
      ok: true,
      mode: 'mock',
      order: {
        orderRef: 'order-1',
        status: 'pending',
      },
    });

    const launch = await request(app).get('/api/auth/bankid/mock/launch/order-1');
    expect(launch.status).toBe(200);
    expect(launch.text).toContain('Mock BankID');

    const complete = await request(app)
      .post('/api/auth/bankid/mock/complete')
      .send({ orderRef: 'order-1', bankidId: 'mock-bankid-testuser-1' });
    expect(complete.status).toBe(200);
    expect(mocks.completeMockBankIdOrder).toHaveBeenCalledWith({
      orderRef: 'order-1',
      bankidId: 'mock-bankid-testuser-1',
    });

    const fail = await request(app)
      .post('/api/auth/bankid/mock/fail')
      .send({ orderRef: 'order-1', hintCode: 'userCancel' });
    expect(fail.status).toBe(200);
    expect(mocks.failMockBankIdOrder).toHaveBeenCalledWith({
      orderRef: 'order-1',
      hintCode: 'userCancel',
    });
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

  it('returns 404 for mock BankID endpoints when mode is not mock', async () => {
    mocks.getBankIdMode.mockReturnValue('production');

    const orders = await request(app).get('/api/auth/bankid/mock/orders/order-1');
    expect(orders.status).toBe(404);

    const launch = await request(app).get('/api/auth/bankid/mock/launch/order-1');
    expect(launch.status).toBe(404);

    const complete = await request(app).post('/api/auth/bankid/mock/complete').send({ orderRef: 'order-1' });
    expect(complete.status).toBe(404);

    const fail = await request(app).post('/api/auth/bankid/mock/fail').send({ orderRef: 'order-1' });
    expect(fail.status).toBe(404);
  });

  it('returns 400 on init error and cancel error', async () => {
    mocks.initiateBankIdAuth.mockRejectedValueOnce(new Error('BankID unavailable'));
    const initErr = await request(app).post('/api/auth/bankid/init').send({ endUserIp: '127.0.0.1' });
    expect(initErr.status).toBe(400);

    mocks.cancelBankIdAuth.mockRejectedValueOnce(new Error('cancel failed'));
    const cancelErr = await request(app).post('/api/auth/bankid/cancel').send({ orderRef: 'order-1' });
    expect(cancelErr.status).toBe(400);
  });

  it('handles logout without refreshToken (revokes only access token)', async () => {
    const res = await request(app).post('/api/auth/logout').set('Authorization', authHeader()).send({});

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, message: 'Logged out successfully' });
  });

  it('returns 401 on missing username in admin login', async () => {
    const res = await request(app)
      .post('/api/admin/auth/login')
      .send({ username: '', password: 'secret-password' });

    expect(res.status).toBe(401);
  });
});
