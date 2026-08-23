import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type BankIdScenario =
  | {
      type?: 'response';
      statusCode?: number;
      body?: string;
    }
  | {
      type: 'timeout';
    }
  | {
      type: 'error';
      error: Error;
    };

const mocks = vi.hoisted(() => {
  const requests: Array<{ options: Record<string, unknown>; body: string }> = [];
  const scenarios: BankIdScenario[] = [];

  const Agent = vi.fn(function MockAgent(this: { options?: unknown }, options: unknown) {
    this.options = options;
  });

  const request = vi.fn((options: Record<string, unknown>, callback: (response: unknown) => void) => {
    const entry = { options, body: '' };
    requests.push(entry);
    const requestHandlers = new Map<string, (value?: unknown) => void>();

    const req = {
      on: vi.fn((event: string, handler: (value?: unknown) => void) => {
        requestHandlers.set(event, handler);
        return req;
      }),
      write: vi.fn((chunk: string) => {
        entry.body += chunk;
      }),
      end: vi.fn(() => {
        const scenario = scenarios.shift();
        if (!scenario) {
          throw new Error('No queued BankID scenario');
        }

        if (scenario.type === 'error') {
          requestHandlers.get('error')?.(scenario.error);
          return;
        }

        if (scenario.type === 'timeout') {
          requestHandlers.get('timeout')?.();
          return;
        }

        const responseHandlers = new Map<string, (value?: unknown) => void>();
        const res = {
          statusCode: scenario.statusCode,
          on: vi.fn((event: string, handler: (value?: unknown) => void) => {
            responseHandlers.set(event, handler);
            return res;
          }),
        };

        callback(res);
        if (scenario.body !== undefined) {
          responseHandlers.get('data')?.(Buffer.from(scenario.body));
        }
        responseHandlers.get('end')?.();
      }),
      destroy: vi.fn((error: Error) => {
        requestHandlers.get('error')?.(error);
      }),
    };

    return req;
  });

  return {
    Agent,
    assertBankIdEnv: vi.fn(),
    createTokenPair: vi.fn(),
    ensureMockAuthUser: vi.fn(),
    ensureTestBankIdUser: vi.fn(),
    findAuthUserByBankId: vi.fn(),
    getEnv: vi.fn(),
    getBankIdRuntimeMode: vi.fn(),
    persistentReplayProtection: {
      registerSession: vi.fn(),
      validateAndComplete: vi.fn(),
      failSession: vi.fn(),
    },
    readFileSync: vi.fn(),
    request,
    requests,
    rotateRefreshToken: vi.fn(),
    scenarios,
  };
});

vi.mock('node:fs', () => ({
  default: {
    readFileSync: mocks.readFileSync,
  },
  readFileSync: mocks.readFileSync,
}));

vi.mock('node:https', () => ({
  default: {
    Agent: mocks.Agent,
    request: mocks.request,
  },
  Agent: mocks.Agent,
  request: mocks.request,
}));

vi.mock('../../server/security/auth', () => ({
  createTokenPair: mocks.createTokenPair,
  rotateRefreshToken: mocks.rotateRefreshToken,
}));

vi.mock('../../server/security/env', () => ({
  assertBankIdEnv: mocks.assertBankIdEnv,
  getEnv: mocks.getEnv,
  getBankIdRuntimeMode: mocks.getBankIdRuntimeMode,
}));

vi.mock('../../server/repositories/userRepository', () => ({
  ensureMockAuthUser: mocks.ensureMockAuthUser,
  ensureTestBankIdUser: mocks.ensureTestBankIdUser,
  findAuthUserByBankId: mocks.findAuthUserByBankId,
}));

vi.mock('../../server/security/persistentReplayProtection', () => ({
  persistentReplayProtection: mocks.persistentReplayProtection,
}));

vi.mock('../../server/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  completeMockBankIdOrder,
  cancelBankIdAuth,
  collectBankIdAuth,
  collectBankIdSign,
  getBankIdMode,
  getMockBankIdOrder,
  generateAnimatedQrPayload,
  initiateBankIdAuth,
  initiateBankIdSign,
  failMockBankIdOrder,
  normalizeBankIdPersonalNumber,
  refreshSession,
} from '../../server/services/bankIdService';

describe('bankIdService', () => {
  const originalEnv = {
    BANKID_CA_PATH: process.env.BANKID_CA_PATH,
    BANKID_CERT_PATH: process.env.BANKID_CERT_PATH,
    BANKID_KEY_PATH: process.env.BANKID_KEY_PATH,
    BANKID_PFX_PATH: process.env.BANKID_PFX_PATH,
    BANKID_PFX_PASSPHRASE: process.env.BANKID_PFX_PASSPHRASE,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requests.length = 0;
    mocks.scenarios.length = 0;

    process.env.BANKID_PFX_PATH = 'certificates/bankid.pfx';
    process.env.BANKID_PFX_PASSPHRASE = 'secret-passphrase';
    delete process.env.BANKID_CERT_PATH;
    delete process.env.BANKID_KEY_PATH;
    delete process.env.BANKID_CA_PATH;

    mocks.assertBankIdEnv.mockImplementation(() => undefined);
    mocks.getBankIdRuntimeMode.mockReturnValue('production');
    mocks.getEnv.mockImplementation((name: string) => {
      switch (name) {
        case 'BANKID_BASE_URL':
          return 'https://bankid.example.test/6.0/';
        case 'BANKID_CERT_PATH':
          return 'certificates/client-cert.pem';
        case 'BANKID_KEY_PATH':
          return 'certificates/client-key.pem';
        default:
          throw new Error(`Unexpected env lookup: ${name}`);
      }
    });
    mocks.readFileSync.mockImplementation((filePath: string) => Buffer.from(`file:${filePath}`));
    mocks.findAuthUserByBankId.mockResolvedValue({
      id: 'user-1',
      organisationId: 'org-1',
      role: 'ADMIN',
      bankidId: '191212121212',
      identityEnvironment: 'PRODUCTION',
    });
    mocks.ensureMockAuthUser.mockResolvedValue({
      id: 'mock-user-1',
      organisationId: 'mock-org-1',
      role: 'ADMIN',
      bankidId: 'mock-bankid-testuser-1',
      identityEnvironment: 'MOCK',
    });
    mocks.createTokenPair.mockReturnValue({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
    });
    mocks.rotateRefreshToken.mockResolvedValue({
      accessToken: 'next-access-token',
      refreshToken: 'next-refresh-token',
      user: {
        id: 'user-1',
        organisationId: 'org-1',
        role: 'ADMIN',
        bankidId: '191212121212',
      },
    });
    mocks.persistentReplayProtection.registerSession.mockResolvedValue({ nonce: 'nonce-1' });
    mocks.persistentReplayProtection.validateAndComplete.mockResolvedValue(undefined);
    mocks.persistentReplayProtection.failSession.mockResolvedValue(undefined);
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key as keyof typeof originalEnv];
      } else {
        process.env[key as keyof typeof originalEnv] = value;
      }
    }
  });

  it('generates animated qr payloads from elapsed seconds', () => {
    const orderTime = new Date('2026-03-21T12:00:00.000Z');
    const now = new Date('2026-03-21T12:00:05.900Z');
    const authCode = crypto.createHmac('sha256', 'qr-secret').update('5').digest('hex');

    const payload = generateAnimatedQrPayload({
      qrStartToken: 'qr-token',
      qrStartSecret: 'qr-secret',
      orderTime,
      now,
    });

    expect(payload).toBe(`bankid.qr-token.5.${authCode}`);
  });

  it('reports current BankID mode from env helper', () => {
    mocks.getBankIdRuntimeMode.mockReturnValueOnce('production');
    expect(getBankIdMode()).toBe('production');

    mocks.getBankIdRuntimeMode.mockReturnValueOnce('mock');
    expect(getBankIdMode()).toBe('mock');
  });

  it('normalizes 12-digit personal numbers and rejects invalid values', () => {
    expect(normalizeBankIdPersonalNumber('19121212-1212')).toBe('191212121212');
    expect(normalizeBankIdPersonalNumber(undefined)).toBeUndefined();
    expect(() => normalizeBankIdPersonalNumber('121212-1212')).toThrow(/12 siffror/i);
  });

  it('initiates mock auth without requiring mTLS configuration', async () => {
    mocks.getBankIdRuntimeMode.mockReturnValue('mock');

    const result = await initiateBankIdAuth('127.0.0.1');

    expect(result.orderRef).toMatch(/^mock-order-/);
    expect(result.launchMode).toBe('mock');
    expect(String(result.launchUrl || '')).toContain('/api/auth/bankid/mock/launch/');
    expect(mocks.assertBankIdEnv).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it('initiates auth using pfx configuration and forwards the request body', async () => {
    process.env.BANKID_CA_PATH = 'certificates/ca.pem';
    mocks.scenarios.push({
      statusCode: 200,
      body: JSON.stringify({
        orderRef: 'order-1',
        autoStartToken: 'auto-token',
        qrStartToken: 'qr-token',
        qrStartSecret: 'qr-secret',
      }),
    });

    const result = await initiateBankIdAuth('127.0.0.1');

    expect(result).toEqual({
      orderRef: 'order-1',
      autoStartToken: 'auto-token',
      qrStartToken: 'qr-token',
      qrStartSecret: 'qr-secret',
    });
    expect(mocks.Agent).toHaveBeenCalledWith(
      expect.objectContaining({
        pfx: expect.any(Buffer),
        passphrase: 'secret-passphrase',
        ca: expect.any(Buffer),
        minVersion: 'TLSv1.2',
      }),
    );
    expect(mocks.readFileSync).toHaveBeenCalledWith('certificates/bankid.pfx');
    expect(mocks.readFileSync).toHaveBeenCalledWith('certificates/ca.pem');
    expect(mocks.requests[0]?.options.path).toBe('/6.0/auth');
    expect(JSON.parse(mocks.requests[0]?.body || '{}')).toEqual(
      expect.objectContaining({
        endUserIp: '127.0.0.1',
        userNonVisibleData: expect.any(String),
      }),
    );
  });

  it('returns pending collect responses without issuing tokens', async () => {
    delete process.env.BANKID_PFX_PATH;
    process.env.BANKID_CERT_PATH = 'certificates/client-cert.pem';
    process.env.BANKID_KEY_PATH = 'certificates/client-key.pem';
    mocks.scenarios.push({
      statusCode: 200,
      body: JSON.stringify({
        orderRef: 'order-1',
        status: 'pending',
        hintCode: 'outstandingTransaction',
      }),
    });

    const result = await collectBankIdAuth('order-1', '127.0.0.1');

    expect(result).toEqual({
      status: 'pending',
      hintCode: 'outstandingTransaction',
    });
    expect(mocks.Agent).toHaveBeenCalledWith(
      expect.objectContaining({
        cert: expect.any(Buffer),
        key: expect.any(Buffer),
        minVersion: 'TLSv1.2',
      }),
    );
    expect(mocks.findAuthUserByBankId).not.toHaveBeenCalled();
    expect(mocks.createTokenPair).not.toHaveBeenCalled();
  });

  it('initiates sign using explicit non-visible data and base64 visible data', async () => {
    mocks.scenarios.push({
      statusCode: 200,
      body: JSON.stringify({
        orderRef: 'sign-order-1',
        autoStartToken: 'sign-auto-token',
        qrStartToken: 'sign-qr-token',
        qrStartSecret: 'sign-qr-secret',
      }),
    });

    const result = await initiateBankIdSign({
      endUserIp: '127.0.0.1',
      userVisibleData: 'Skriv under dokument',
      userNonVisibleData: 'nonce-sign-1',
    });

    expect(result.orderRef).toBe('sign-order-1');
    expect(mocks.requests.at(-1)?.options.path).toBe('/6.0/sign');
    expect(JSON.parse(mocks.requests.at(-1)?.body || '{}')).toEqual({
      endUserIp: '127.0.0.1',
      userVisibleData: Buffer.from('Skriv under dokument').toString('base64'),
      userNonVisibleData: 'nonce-sign-1',
    });
    expect(mocks.persistentReplayProtection.registerSession).toHaveBeenCalledWith(
      'sign-order-1',
      '127.0.0.1',
      'PRODUCTION',
    );
  });

  it('initiates mock sign and stores replay session without mtls', async () => {
    mocks.getBankIdRuntimeMode.mockReturnValue('mock');

    const result = await initiateBankIdSign({
      endUserIp: '127.0.0.1',
      userVisibleData: 'Mocksignera',
    });

    expect(result.orderRef).toMatch(/^mock-order-/);
    expect(result.launchMode).toBe('mock');
    expect(mocks.persistentReplayProtection.registerSession).toHaveBeenCalledWith(
      result.orderRef,
      '127.0.0.1',
      'MOCK',
    );
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it('returns complete collect responses for permitted users', async () => {
    mocks.scenarios.push({
      statusCode: 200,
      body: JSON.stringify({
        orderRef: 'order-2',
        status: 'complete',
        completionData: {
          user: {
            personalNumber: '191212121212',
            givenName: 'Test',
            surname: 'User',
            name: 'Test User',
          },
          device: {
            ipAddress: '127.0.0.1',
          },
          cert: {
            notBefore: '2026-03-21T12:00:00.000Z',
            notAfter: '2028-03-21T12:00:00.000Z',
          },
          signature: 'signature',
          ocspResponse: 'ocsp',
        },
      }),
    });

    const result = await collectBankIdAuth('order-2', '127.0.0.1');

    expect(mocks.persistentReplayProtection.validateAndComplete).toHaveBeenCalledWith({
      orderRef: 'order-2',
      ipAddress: '127.0.0.1',
      bankidId: '191212121212',
      signature: 'signature',
    });
    expect(mocks.findAuthUserByBankId).toHaveBeenCalledWith('191212121212');
    expect(mocks.createTokenPair).toHaveBeenCalledWith({
      id: 'user-1',
      organisationId: 'org-1',
      role: 'ADMIN',
      bankidId: '191212121212',
      identityEnvironment: 'PRODUCTION',
    });
    expect(result).toEqual({
      status: 'complete',
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      user: {
        id: 'user-1',
        organisationId: 'org-1',
        role: 'ADMIN',
        bankidId: '191212121212',
        displayName: 'Test User',
      },
    });
  });

  it('auto-provisions mock users when mock mode is enabled', async () => {
    mocks.getBankIdRuntimeMode.mockReturnValue('mock');
    mocks.findAuthUserByBankId.mockResolvedValueOnce(null);

    const started = await initiateBankIdAuth('127.0.0.1');
    completeMockBankIdOrder({ orderRef: started.orderRef, bankidId: 'mock-bankid-testuser-1' });

    const result = await collectBankIdAuth(started.orderRef, '127.0.0.1');

    expect(mocks.ensureMockAuthUser).toHaveBeenCalledWith('mock-bankid-testuser-1');
    expect(result).toEqual({
      status: 'complete',
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      user: {
        id: 'mock-user-1',
        organisationId: 'mock-org-1',
        role: 'ADMIN',
        bankidId: 'mock-bankid-testuser-1',
        displayName: 'Mock User',
      },
    });
  });

  it('provisions an explicitly marked test identity only in official test mode', async () => {
    mocks.getBankIdRuntimeMode.mockReturnValue('test');
    mocks.findAuthUserByBankId.mockResolvedValueOnce(null);
    mocks.ensureTestBankIdUser.mockResolvedValueOnce({
      id: 'test-user-1',
      organisationId: 'test-org-1',
      role: 'CONSULTANT',
      bankidId: '191212121212',
      identityEnvironment: 'TEST',
    });
    mocks.scenarios.push({
      statusCode: 200,
      body: JSON.stringify({
        orderRef: 'test-order-1',
        status: 'complete',
        completionData: {
          user: { personalNumber: '191212121212', givenName: 'Test', surname: 'User', name: 'Test User' },
          device: { ipAddress: '127.0.0.1' },
          cert: { notBefore: '2026-01-01T00:00:00.000Z', notAfter: '2027-01-01T00:00:00.000Z' },
          signature: 'test-bankid-signature',
          ocspResponse: 'test-ocsp',
        },
      }),
    });

    const result = await collectBankIdAuth('test-order-1', '127.0.0.1');

    expect(mocks.ensureTestBankIdUser).toHaveBeenCalledWith('191212121212');
    expect(mocks.ensureMockAuthUser).not.toHaveBeenCalled();
    expect(result.user).toMatchObject({ id: 'test-user-1', role: 'CONSULTANT', bankidId: '191212121212' });
  });

  it('records TEST provenance when an official test-environment order begins', async () => {
    mocks.getBankIdRuntimeMode.mockReturnValue('test');
    mocks.scenarios.push({
      statusCode: 200,
      body: JSON.stringify({ orderRef: 'test-order-session-1', autoStartToken: 'auto', qrStartToken: 'qr', qrStartSecret: 'secret' }),
    });

    await initiateBankIdAuth('127.0.0.1');

    expect(mocks.persistentReplayProtection.registerSession).toHaveBeenCalledWith(
      'test-order-session-1',
      '127.0.0.1',
      'TEST',
    );
  });

  it('fails closed instead of reusing a production identity in the official test environment', async () => {
    mocks.getBankIdRuntimeMode.mockReturnValue('test');
    mocks.findAuthUserByBankId.mockResolvedValueOnce({
      id: 'production-user-1',
      organisationId: 'production-org-1',
      role: 'ADMIN',
      bankidId: '191212121212',
      identityEnvironment: 'PRODUCTION',
    });
    mocks.scenarios.push({
      statusCode: 200,
      body: JSON.stringify({
        orderRef: 'test-order-2',
        status: 'complete',
        completionData: {
          user: { personalNumber: '191212121212', givenName: 'Test', surname: 'User', name: 'Test User' },
          device: { ipAddress: '127.0.0.1' },
          cert: { notBefore: '2026-01-01T00:00:00.000Z', notAfter: '2027-01-01T00:00:00.000Z' },
          signature: 'test-bankid-signature-2',
          ocspResponse: 'test-ocsp',
        },
      }),
    });

    await expect(collectBankIdAuth('test-order-2', '127.0.0.1')).rejects.toThrow(/identity environment mismatch/i);
    expect(mocks.ensureTestBankIdUser).not.toHaveBeenCalled();
  });

  it('does not auto-provision mock users when auto-create is disabled', async () => {
    process.env.BANKID_MOCK_AUTO_CREATE_USER = 'nej';
    mocks.getBankIdRuntimeMode.mockReturnValue('mock');
    mocks.findAuthUserByBankId.mockResolvedValueOnce(null);

    const started = await initiateBankIdAuth('127.0.0.1');
    completeMockBankIdOrder({ orderRef: started.orderRef, bankidId: 'mock-bankid-testuser-2' });

    await expect(collectBankIdAuth(started.orderRef, '127.0.0.1')).rejects.toThrow(
      /not registered in a permitted organisation/i,
    );
    expect(mocks.ensureMockAuthUser).not.toHaveBeenCalled();
  });

  it('collects completed sign responses and runs replay validation', async () => {
    mocks.scenarios.push({
      statusCode: 200,
      body: JSON.stringify({
        orderRef: 'sign-order-2',
        status: 'complete',
        completionData: {
          user: {
            personalNumber: '191212121212',
            givenName: 'Test',
            surname: 'Signer',
            name: 'Test Signer',
          },
          device: {
            ipAddress: '127.0.0.1',
          },
          cert: {
            notBefore: '2026-03-21T12:00:00.000Z',
            notAfter: '2028-03-21T12:00:00.000Z',
          },
          signature: 'sign-signature',
          ocspResponse: 'sign-ocsp',
        },
      }),
    });

    const result = await collectBankIdSign('sign-order-2', '127.0.0.1');

    expect(result.status).toBe('complete');
    expect(mocks.persistentReplayProtection.validateAndComplete).toHaveBeenCalledWith({
      orderRef: 'sign-order-2',
      ipAddress: '127.0.0.1',
      bankidId: '191212121212',
      signature: 'sign-signature',
    });
  });

  it('tracks and updates mock order state through complete and fail helpers', async () => {
    mocks.getBankIdRuntimeMode.mockReturnValue('mock');

    const started = await initiateBankIdAuth('127.0.0.1');
    expect(getMockBankIdOrder(started.orderRef)).toMatchObject({
      orderRef: started.orderRef,
      status: 'pending',
    });

    failMockBankIdOrder({ orderRef: started.orderRef, hintCode: 'userCancel' });
    expect(getMockBankIdOrder(started.orderRef)).toMatchObject({
      orderRef: started.orderRef,
      status: 'failed',
      hintCode: 'userCancel',
    });

    completeMockBankIdOrder({ orderRef: started.orderRef, bankidId: 'mock-bankid-testuser-1' });
    expect(getMockBankIdOrder(started.orderRef)).toMatchObject({
      orderRef: started.orderRef,
      status: 'complete',
      completionData: {
        user: {
          personalNumber: 'mock-bankid-testuser-1',
        },
      },
    });
  });

  it('rejects complete responses without a personal number', async () => {
    mocks.scenarios.push({
      statusCode: 200,
      body: JSON.stringify({
        orderRef: 'order-3',
        status: 'complete',
        completionData: {
          user: {},
        },
      }),
    });

    await expect(collectBankIdAuth('order-3', '127.0.0.1')).rejects.toThrow(
      /complete response missing personal number/i,
    );
  });

  it('rejects complete responses for users outside permitted organisations', async () => {
    mocks.findAuthUserByBankId.mockResolvedValueOnce(null);
    mocks.scenarios.push({
      statusCode: 200,
      body: JSON.stringify({
        orderRef: 'order-4',
        status: 'complete',
        completionData: {
          user: {
            personalNumber: '191212121212',
          },
        },
      }),
    });

    await expect(collectBankIdAuth('order-4', '127.0.0.1')).rejects.toThrow(
      /not registered in a permitted organisation/i,
    );
  });

  it('rejects invalid json responses from BankID', async () => {
    mocks.scenarios.push({
      statusCode: 200,
      body: 'not-json',
    });

    await expect(initiateBankIdAuth('127.0.0.1')).rejects.toThrow(/invalid json response/i);
  });

  it('rejects http errors from BankID', async () => {
    mocks.scenarios.push({
      statusCode: 500,
      body: 'upstream failure',
    });

    await expect(cancelBankIdAuth('order-5')).rejects.toThrow(
      /BankID request failed \(500\): upstream failure/,
    );
  });

  it('cancels mock auth orders and marks replay protection as failed', async () => {
    mocks.getBankIdRuntimeMode.mockReturnValue('mock');
    const started = await initiateBankIdAuth('127.0.0.1');

    const result = await cancelBankIdAuth(started.orderRef);

    expect(result).toEqual({ cancelled: true });
    expect(getMockBankIdOrder(started.orderRef)).toMatchObject({
      status: 'failed',
      hintCode: 'userCancel',
    });
    expect(mocks.persistentReplayProtection.failSession).toHaveBeenCalledWith(started.orderRef, 'userCancel');
  });

  it('throws when requesting an unknown mock order', () => {
    expect(() => getMockBankIdOrder('missing-order')).toThrow(/Mock BankID order not found/);
  });

  it('cancels real auth orders through the cancel endpoint', async () => {
    mocks.scenarios.push({
      statusCode: 200,
      body: JSON.stringify({ message: 'cancelled' }),
    });

    const result = await cancelBankIdAuth('real-order-1');

    expect(result).toEqual({ cancelled: true });
    expect(mocks.requests.at(-1)?.options.path).toBe('/6.0/cancel');
    expect(JSON.parse(mocks.requests.at(-1)?.body || '{}')).toEqual({ orderRef: 'real-order-1' });
    expect(mocks.persistentReplayProtection.failSession).toHaveBeenCalledWith('real-order-1', 'userCancel');
  });

  it('rejects timed out BankID requests', async () => {
    mocks.scenarios.push({
      type: 'timeout',
    });

    await expect(initiateBankIdAuth('127.0.0.1')).rejects.toThrow(/timeout/i);
  });

  it('refreshes sessions through rotated refresh tokens', async () => {
    const result = await refreshSession('old-refresh-token');

    expect(mocks.rotateRefreshToken).toHaveBeenCalledWith('old-refresh-token');
    expect(result).toEqual({
      accessToken: 'next-access-token',
      refreshToken: 'next-refresh-token',
    });
  });
});
