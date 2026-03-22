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
    findAuthUserByBankId: vi.fn(),
    getEnv: vi.fn(),
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
}));

vi.mock('../../server/repositories/userRepository', () => ({
  findAuthUserByBankId: mocks.findAuthUserByBankId,
}));

import {
  cancelBankIdAuth,
  collectBankIdAuth,
  generateAnimatedQrPayload,
  initiateBankIdAuth,
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
    mocks.getEnv.mockImplementation((name: string) => {
      switch (name) {
        case 'BANKID_BASE_URL':
          return 'https://bankid.example.test/rp/v6.0/';
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
    expect(mocks.requests[0]?.options.path).toBe('/rp/v6.0/auth');
    expect(JSON.parse(mocks.requests[0]?.body || '{}')).toEqual({ endUserIp: '127.0.0.1' });
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

    const result = await collectBankIdAuth('order-1');

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

    const result = await collectBankIdAuth('order-2');

    expect(mocks.findAuthUserByBankId).toHaveBeenCalledWith('191212121212');
    expect(mocks.createTokenPair).toHaveBeenCalledWith({
      id: 'user-1',
      organisationId: 'org-1',
      role: 'ADMIN',
      bankidId: '191212121212',
    });
    expect(result).toEqual({
      status: 'complete',
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      user: {
        id: 'user-1',
        organisationId: 'org-1',
        role: 'ADMIN',
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

    await expect(collectBankIdAuth('order-3')).rejects.toThrow(/complete response missing personal number/i);
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

    await expect(collectBankIdAuth('order-4')).rejects.toThrow(/not registered in a permitted organisation/i);
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
