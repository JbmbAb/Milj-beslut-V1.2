import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BankIdAdapter } from '../../../src/infrastructure/bankid-adapter';

// Mock dependencies - must mock before importing the adapter
vi.mock('../../../server/security/env.ts', () => ({
  isBankIdMockMode: vi.fn().mockReturnValue(true),
  getEnv: vi.fn((key) => {
    const env: Record<string, string> = {
      BANKID_BASE_URL: 'https://appapi2.bankid.com/rp/v6.0',
      BANKID_PFX_PATH: '/dummy/path.pfx',
      BANKID_CERT_PATH: '/dummy/cert.pem',
      BANKID_KEY_PATH: '/dummy/key.pem',
    };
    return env[key] || key;
  }),
  assertBankIdEnv: vi.fn(),
}));

describe('BankIdAdapter', () => {
  let adapter: BankIdAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new BankIdAdapter();
  });

  it('should return mock mode', () => {
    expect(adapter.getMode()).toBe('mock');
  });

  describe('Mock Mode', () => {
    it('should initiate auth and return mock payload', async () => {
      const result = await adapter.initiateAuth('127.0.0.1');
      expect(result.launchMode).toBe('mock');
      expect(result.orderRef).toBeDefined();
      expect(result.launchUrl).toBeDefined();
    });

    it('should collect auth and return status', async () => {
      const init = await adapter.initiateAuth('127.0.0.1');
      const result = await adapter.collectAuth(init.orderRef);
      expect(result.status).toBe('pending');
      expect(result.hintCode).toBe('outstandingTransaction');
    });

    it('should throw if collecting non-existent order', async () => {
      await expect(adapter.collectAuth('missing')).rejects.toThrow('Mock BankID order not found');
    });

    it('should cancel auth and set status to failed', async () => {
      const init = await adapter.initiateAuth('127.0.0.1');
      const cancelled = await adapter.cancelAuth(init.orderRef);
      expect(cancelled).toBe(true);

      const result = await adapter.collectAuth(init.orderRef);
      expect(result.status).toBe('failed');
      expect(result.hintCode).toBe('userCancel');
    });

    it('should complete mock order', async () => {
      const init = await adapter.initiateAuth('127.0.0.1');
      adapter.completeMockOrder(init.orderRef, '199001011234');

      const result = await adapter.collectAuth(init.orderRef);
      expect(result.status).toBe('complete');
      expect(result.completionData?.user.personalNumber).toBe('199001011234');
    });
  });
});
