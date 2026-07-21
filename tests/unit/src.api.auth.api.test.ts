import { describe, expect, it, vi } from 'vitest';
import { AuthController } from '../../src/api/auth.api';

const authUseCaseMocks = vi.hoisted(() => ({
  collectExecute: vi.fn(),
  initiateExecute: vi.fn(),
}));

vi.mock('../../src/application/initiate-bankid-auth.usecase', () => ({
  InitiateBankIdAuthUseCase: class {
    execute = authUseCaseMocks.initiateExecute;
  },
}));

vi.mock('../../src/application/collect-bankid-auth.usecase', () => ({
  CollectBankIdAuthUseCase: class {
    execute = authUseCaseMocks.collectExecute;
  },
}));

describe('src/api/auth.api', () => {
  it('delegates initiate, collect and cancel calls', async () => {
    const bankIdProvider = {
      cancelAuth: vi.fn().mockResolvedValue(undefined),
    } as any;
    const userRepo = {} as any;
    const controller = new AuthController(bankIdProvider, userRepo);

    authUseCaseMocks.initiateExecute.mockResolvedValue({ orderRef: '1' });
    authUseCaseMocks.collectExecute.mockResolvedValue({ status: 'pending' });

    await expect(controller.initiateBankId('127.0.0.1')).resolves.toEqual({ orderRef: '1' });
    await expect(controller.collectBankId('order-1')).resolves.toEqual({ status: 'pending' });
    await expect(controller.cancelBankId('order-1')).resolves.toBeUndefined();

    expect(authUseCaseMocks.initiateExecute).toHaveBeenCalledWith({ endUserIp: '127.0.0.1' });
    expect(authUseCaseMocks.collectExecute).toHaveBeenCalledWith({ orderRef: 'order-1' });
    expect(bankIdProvider.cancelAuth).toHaveBeenCalledWith('order-1');
  });
});
