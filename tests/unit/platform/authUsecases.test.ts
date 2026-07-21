import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InitiateBankIdAuthUseCase } from '../../../src/application/initiate-bankid-auth.usecase';
import { CollectBankIdAuthUseCase } from '../../../src/application/collect-bankid-auth.usecase';

vi.mock('../../../server/security/auth', () => ({
  createTokenPair: vi.fn().mockReturnValue({ accessToken: 'access', refreshToken: 'refresh' }),
}));

describe('Auth Use Cases', () => {
  const mockBankIdProvider = {
    initiateAuth: vi.fn(),
    collectAuth: vi.fn(),
    cancelAuth: vi.fn(),
    getMode: vi.fn().mockReturnValue('mock'),
  };

  const mockUserRepo = {
    findByBankId: vi.fn(),
    ensureMockUser: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('InitiateBankIdAuthUseCase', () => {
    it('should initiate auth and generate qr payload', async () => {
      mockBankIdProvider.initiateAuth.mockResolvedValueOnce({
        orderRef: 'o1',
        autoStartToken: 'a1',
        qrStartToken: 'q1',
        qrStartSecret: 's1',
      });

      const useCase = new InitiateBankIdAuthUseCase(mockBankIdProvider as any);
      const result = await useCase.execute({ endUserIp: '127.0.0.1' });

      expect(result.orderRef).toBe('o1');
      expect(result.qrPayload).toContain('bankid.q1.');
      expect(mockBankIdProvider.initiateAuth).toHaveBeenCalledWith('127.0.0.1', {
        personalNumber: undefined,
      });
    });
  });

  describe('CollectBankIdAuthUseCase', () => {
    let useCase: CollectBankIdAuthUseCase;

    beforeEach(() => {
      useCase = new CollectBankIdAuthUseCase(mockBankIdProvider as any, mockUserRepo as any);
    });

    it('should return pending status if not complete', async () => {
      mockBankIdProvider.collectAuth.mockResolvedValueOnce({
        status: 'pending',
        hintCode: 'outstandingTransaction',
      });

      const result = await useCase.execute({ orderRef: 'o1' });
      expect(result.status).toBe('pending');
      expect(result.hintCode).toBe('outstandingTransaction');
    });

    it('should throw if completion data is missing personal number', async () => {
      mockBankIdProvider.collectAuth.mockResolvedValueOnce({
        status: 'complete',
        completionData: { user: {} },
      });

      await expect(useCase.execute({ orderRef: 'o1' })).rejects.toThrow('missing personal number');
    });

    it('should throw if user not found in real mode', async () => {
      mockBankIdProvider.collectAuth.mockResolvedValueOnce({
        status: 'complete',
        completionData: { user: { personalNumber: '199001011234' } },
      });
      mockBankIdProvider.getMode.mockReturnValueOnce('real');
      mockUserRepo.findByBankId.mockResolvedValueOnce(null);

      await expect(useCase.execute({ orderRef: 'o1' })).rejects.toThrow('not registered');
    });

    it('should auto-create mock user in mock mode', async () => {
      mockBankIdProvider.collectAuth.mockResolvedValueOnce({
        status: 'complete',
        completionData: { user: { personalNumber: '199001011234' } },
      });
      mockBankIdProvider.getMode.mockReturnValueOnce('mock');
      mockUserRepo.findByBankId.mockResolvedValueOnce(null);
      mockUserRepo.ensureMockUser.mockResolvedValueOnce({
        id: 'u1',
        role: 'ADMIN',
        organisationId: 'org1',
      });

      const result = await useCase.execute({ orderRef: 'o1' });

      expect(result.status).toBe('complete');
      expect(result.accessToken).toBe('access');
      expect(mockUserRepo.ensureMockUser).toHaveBeenCalledWith('199001011234');
    });
  });
});
